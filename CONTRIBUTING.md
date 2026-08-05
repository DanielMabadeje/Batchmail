# Contributing to Batchmail

Issues and pull requests welcome. This document exists mainly so you don't
lose an afternoon to the same setup problems everyone else has.

Read [`docs/architecture.md`](docs/architecture.md) first if you're changing
anything in the send loop or the claim/lease logic. The concurrency story
there is load-bearing.

## Setup

Follow **[docs/setup.md](docs/setup.md)** — it covers the Google Cloud
project, backend, extension, and first send. Everything there applies whether
you're running Batchmail or working on it.

Two things worth doing beyond that guide:

- Use Postgres rather than MySQL if you have a choice. It matches what
  `docker-compose.yml` specifies for self-hosters, so you develop against
  what you ship.
- Enable the Google Sheets API in your Cloud project even if you don't plan
  to touch the import feature, so you can test it if a change turns out to
  affect it.

## Development

```bash
# terminal 1
cd api && php artisan serve

# terminal 2
cd extension && npm run build -- --watch
```

**Use `build --watch`, not `npm run dev`.** CRXJS's dev-mode loader mangles
content-script paths (`index.js.js`) and requests a `vendor/vite-client.js`
that doesn't exist in the extension. `dev` is fine if you're only touching
the popup or options pages.

After any change: reload the extension from `chrome://extensions`, then
hard-refresh Gmail. Content scripts only inject on page load, and service
worker changes need the reload — you will otherwise edit `sender.js`, see no
change, and conclude the code is broken.

The **service worker** link on the extension card opens the console where all
`sender.js` and `auth.js` errors surface. They appear nowhere else.

Keep other Gmail extensions disabled while debugging. Anything using InboxSDK
mutates the same DOM and fills the console with noise.

## Gotchas

Ordered by hours lost.

- **`localhost` vs `127.0.0.1` are different origins to CORS.** Pick one and
  use it in `VITE_API_BASE_URL`, the options page field, and how you start
  `artisan serve`.
- **Test-mode refresh tokens expire after 7 days.** "Reconnect required"
  appearing out of nowhere is expected, not a bug.
- **The extension ID is derived from the folder path.** Move the project and
  the ID changes, breaking your redirect URI and CORS origin. Pinning it with
  a manifest `key` is on the roadmap.
- **`403` from the Sheets API usually means the API isn't enabled**, not that
  you lack access to the sheet.
- **Laravel 11 emptied the base `Controller`.** `$this->authorize()` needs
  `AuthorizesRequests` added back.
- **`routes/api.php` isn't registered** until `php artisan install:api` adds
  the `api:` entry to `bootstrap/app.php`.

## Conventions

**Backend.** Business logic in services, not controllers — controllers
validate and delegate. Anything that writes to `campaign_recipients` during a
send goes inside the existing transaction. Add new writable columns to
`$fillable` or Eloquent drops them silently.

**Extension.** `src/lib/` is pure functions with no `chrome.*` access, so it
can be tested directly with Node. Credentials never leave
`src/background/` — the content script asks the service worker via
`chrome.runtime.sendMessage` and gets data back, never a token.

**Comments** explain why, not what. The interesting comments in this codebase
are the ones recording a decision that looks wrong until you know the
constraint — why the launcher floats, why the panel CSS is a JS module, why
rate limits back off the account rather than the message.

## Things to be careful with

**The claim/lease logic** (`ClaimService`). Two tabs receiving the same
recipient means someone gets your email twice. If you change it, test with
two Gmail windows on one campaign and confirm disjoint sets.

**Scopes.** Never add a restricted scope — `gmail.readonly`, `gmail.modify`,
`mail.google.com`. They trigger an annual paid security assessment. Reply
detection and threading are tempting and live on the wrong side of that line.

**Pacing floors.** `min_delay_seconds` has a server-side floor for a reason.
Sending faster is how users get their accounts throttled, and they'll blame
Batchmail.

**Anything that touches deliverability** — unsubscribe handling, the
`List-Unsubscribe` header, list hygiene. These aren't features, they're the
difference between a mail merge tool and a spam cannon.

## Pull requests

- One concern per PR.
- If you fix something from the Gotchas list above, delete it from this file.
- New behaviour in the send loop or claim path wants a test. Everything else,
  use judgement.
- Don't commit `.env`, `dist/`, or `node_modules/`.

## Licence

MIT. By contributing you agree your work is licensed the same way.