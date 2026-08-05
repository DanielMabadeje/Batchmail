# Setting up Batchmail

A complete walkthrough for running your own instance. Allow about 30 minutes,
most of it in the Google Cloud Console.

If you want to *develop* Batchmail rather than just run it, read
[CONTRIBUTING.md](../CONTRIBUTING.md) after this.

## What you need

- A Google account (the one you'll send from)
- A **Google Cloud project** — free, no billing required for this
- **Node 20+** and **PHP 8.2+** with Composer
- **PostgreSQL 12+ or MySQL 8+**. Not SQLite — see the warning below.
- Chrome

Nothing else. No mail server, no domain, no SendGrid account.

> **Why not SQLite?** Batchmail hands work to the browser using
> `SELECT ... FOR UPDATE SKIP LOCKED`, which SQLite doesn't support. On
> SQLite the query appears to work while giving two open Gmail tabs the same
> recipients — meaning people receive your email twice. This is not a
> theoretical risk; use Postgres or MySQL 8.

## 1. Google Cloud

Batchmail can't ship a shared OAuth client — Google ties them to a verified
app, and verification requires a domain you own. So each installation uses
its own project. The upside is that your sending stays entirely between you
and Google.

### Create the project

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a new project, name it whatever you like
3. **Switch to it in the project selector at the top.** Easy to skip, and
   everything afterwards silently lands in the wrong project.

### Enable the APIs

APIs & Services → **Library**:

- **Gmail API** — required
- **Google Sheets API** — only if you want to import recipients from a Sheets
  link. You can add it later.

### Configure the consent screen

Google reorganised this into **Google Auth Platform** during 2025-26. Older
tutorials describe menus that no longer exist; both the new path and the
legacy APIs & Services → Credentials route still work.

1. Google Auth Platform → **Get started**
2. Fill in an app name and your email
3. Audience: **External**
4. **Leave publishing status as Testing.** This is what keeps you out of
   Google's verification process. Testing mode supports 100 test users, which
   is plenty for personal use or a small team, and does not expire.

### Add scopes

Data Access → Add or remove scopes:

| Scope | Needed for |
|---|---|
| `https://www.googleapis.com/auth/gmail.send` | Sending. Required. |
| `https://www.googleapis.com/auth/spreadsheets.readonly` | Google Sheets import. Optional. |

Both are classified **sensitive**, not restricted — they need verification
if you ever publish publicly, but never a paid third-party security audit.

> **Don't add `gmail.readonly`, `gmail.modify`, or `mail.google.com`.** Those
> are restricted scopes and trigger an annual CASA security assessment. They
> also give an app far more access to your mailbox than sending requires.

### Add yourself as a test user

Audience → **Test users** → Add users → your Gmail address.

Owning the project does **not** grant you access. Skip this and you'll get
"Access blocked: Batchmail has not completed the Google verification
process" when you try to connect.

Add every address you plan to send from.

### Create the OAuth client

Credentials → Create credentials → OAuth client ID → **Web application**.

> Not "Chrome Extension", not "Desktop app". Batchmail authenticates with
> `chrome.identity.launchWebAuthFlow`, which redirects to a
> `chromiumapp.org` URL that only a Web application client can register.

Leave the redirect URI empty for now — you need your extension ID first, and
you'll come back in step 4.

**When you click Create, copy the client secret immediately.** Google masks
it afterwards and there is no way to view it again; you'd have to generate a
replacement.

## 2. Backend

```bash
cd api
composer install
cp .env.example .env
php artisan key:generate
php artisan install:api
```

Start a database. Postgres in Docker is the quickest:

```bash
docker run -d --name batchmail-db -p 5432:5432 \
  -e POSTGRES_DB=batchmail \
  -e POSTGRES_USER=batchmail \
  -e POSTGRES_PASSWORD=secret \
  -v batchmail-pgdata:/var/lib/postgresql/data \
  postgres:16-alpine
```

If port 5432 is taken, use `-p 5433:5432` and set `DB_PORT=5433` below.

Edit `api/.env`:

```ini
APP_URL=http://localhost:8000

DB_CONNECTION=pgsql
DB_HOST=127.0.0.1
DB_PORT=5432
DB_DATABASE=batchmail
DB_USERNAME=batchmail
DB_PASSWORD=secret

# From your OAuth client
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# Filled in at step 4
EXTENSION_ORIGINS=
```

The client secret lives here and nowhere else. The extension never sees it.

```bash
php artisan migrate
php artisan serve
```

`php artisan migrate:status` should list every migration as ran.

## 3. Extension

```bash
cd extension
npm install
cp .env.example .env
```

Edit `extension/.env`:

```ini
VITE_GOOGLE_CLIENT_ID=          # same client ID as the backend, no secret
VITE_API_BASE_URL=http://localhost:8000
```

> Use the same spelling of `localhost` (or `127.0.0.1`) in both files and
> when starting the server. They are different origins to CORS, and mixing
> them produces failures that look like the server being down.

```bash
npm run build
```

Then in Chrome:

1. Go to `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. **Load unpacked** → select `extension/dist`

Select `dist`, not `extension/`. The manifest references source paths that
the build rewrites.

## 4. Connect the two

Copy the **extension ID** shown on the extension's card — a 32-character
string like `gnaijhajcmffjophmanmpmejbplnmmke`.

**In Google Cloud** → Credentials → your OAuth client → Authorised redirect
URIs → Add:

```
https://<your-extension-id>.chromiumapp.org/
```

The trailing slash matters. Chrome generates the URL with one and Google
matches the string exactly; without it you get `redirect_uri_mismatch`.

**In `api/.env`:**

```ini
EXTENSION_ORIGINS=chrome-extension://<your-extension-id>
```

Then:

```bash
php artisan config:clear
php artisan serve      # restart
```

Reload the extension from `chrome://extensions`.

## 5. Connect a Gmail account

Open the extension's options page — puzzle-piece icon in Chrome's toolbar →
Batchmail → ⋮ → Options.

Check the server address, then **Connect a Gmail account**. Google's consent
screen appears; approve it. The account should appear with a quota meter
showing sends remaining today.

## 6. Send something

Open Gmail and hard-refresh (Cmd/Ctrl + Shift + R). A **Batchmail** button
appears bottom-right.

Click it, then:

1. Name the campaign
2. Paste recipients — copy cells straight from a spreadsheet, or paste a
   Google Sheets link and hit Import. The first row becomes column names and
   every column becomes a merge field.
3. Write a subject and message. Click a merge-field chip to insert it.
4. Pick the account to send from
5. **Start sending**

Send to yourself first. Then two or three recipients to watch the pacing.

Keep the Gmail tab open — sending stops when Chrome closes and resumes when
you reopen it.

## Troubleshooting

**"Access blocked: has not completed the Google verification process"**
Your address isn't in Test users. Google Auth Platform → Audience → Test
users.

**`redirect_uri_mismatch`**
The redirect URI doesn't match your extension ID, or is missing the trailing
slash.

**Requests fail with a CORS error**
`EXTENSION_ORIGINS` doesn't match your extension ID, or you didn't run
`php artisan config:clear` and restart the server. Also check `localhost` vs
`127.0.0.1` consistency.

**404 on `/api/auth/google/exchange`**
`routes/api.php` isn't registered. Run `php artisan install:api`, then check
`bootstrap/app.php` has an `api:` entry in `withRouting`.

**Sheets import returns 403**
Usually the Sheets API isn't enabled in your Cloud project, not a sharing
problem. Enable it, wait a minute, then disconnect and reconnect the account
so the new scope is granted.

**"Reconnect required" appears out of nowhere**
Refresh tokens issued by an app in Testing mode expire after 7 days. Expected
behaviour — just reconnect.

**No Batchmail button in Gmail**
Reload the extension, then hard-refresh Gmail. Content scripts only inject on
page load.

**The extension stops working after you move the project folder**
Unpacked extension IDs are derived from the folder path. Moving it changes
the ID, breaking the redirect URI and CORS origin. Update both, or don't move
it.

## What this does not do

- Campaigns don't run with Chrome closed
- No scheduling or drip sequences
- No reply detection or bounce processing
- Open/click tracking has a schema but no endpoints yet
- It cannot raise Gmail's sending limits — nothing can