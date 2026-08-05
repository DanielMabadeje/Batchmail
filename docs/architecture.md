# Batchmail — architecture

## The one-line version

The extension sends the mail. The backend keeps score.

## Why it is split that way

Batchmail sends through the user's own Gmail account. There are two ways to
do that, with very different consequences:

| | Client-side (v1) | Server-side (later) |
|---|---|---|
| Who holds the Gmail token | Extension, in `chrome.storage` | Backend, encrypted at rest |
| Campaigns run with browser closed | No | Yes |
| OAuth review burden | Lower — no credential custody | Higher |
| Hosting cost | Near zero; backend idles | Always-on compute |
| Blast radius if breached | One user's local profile | Every user's mailbox |

v1 is client-side because it makes Batchmail free to run and removes token
custody entirely. Server-side sending is the natural paid feature later:
"your campaigns keep going with your laptop shut" is worth money, and by then
the security posture it demands can be afforded.

**Consequence to hold onto:** the backend never holds a usable Gmail
credential. It cannot retry a failed send. It can only record that one failed
and hand it back to the client next time the client asks for work.

## Authentication

The extension runs the redirect and generates the PKCE pair. **The backend
completes the token exchange**, because `launchWebAuthFlow` redirects to
`chromiumapp.org`, which only a "Web application" OAuth client can register,
and Google demands that client's secret at the token endpoint even with PKCE.

```
extension                     backend                    Google
    |                            |                          |
    |-- launchWebAuthFlow -------|------------------------->|
    |<-- authorization code -----|--------------------------|
    |                            |                          |
    |-- POST /auth/google/exchange ------------------------->|
    |   { code, code_verifier }  |-- exchange w/ secret ---->|
    |                            |<-- tokens + id_token -----|
    |<-- { batchmail token, gmail tokens } ------------------|
    |                            |
    |   Gmail tokens stored in chrome.storage. The backend
    |   does not persist them.
```

Collapsing sign-in and exchange into one call removed the need to verify an
id_token's `aud` claim: the token arrives directly from Google's endpoint in
response to our own authenticated request, so there is no path where an
attacker-supplied token reaches that code.

`prompt=consent` fires on every connect. Google only returns a refresh token
on an account's first authorisation otherwise, which makes reconnect flows
produce an account that silently cannot refresh.

### Scopes

| Scope | Class | When requested |
|---|---|---|
| `gmail.send` | Sensitive | At connect |
| `openid` / `email` / `profile` | Non-sensitive | At connect |
| `spreadsheets.readonly` | Sensitive | First Sheets import only |

**Never add a restricted scope.** `gmail.readonly`, `gmail.modify`, and
`mail.google.com` all trigger an annual third-party security assessment
(CASA) that a free project cannot absorb. Reply detection and threading are
attractive features that live on the wrong side of that line.

Sheets access uses incremental authorisation — `ensureSheetsScope()` prompts
only when someone actually pastes a Sheets link, with
`include_granted_scopes=true` so the existing `gmail.send` grant is carried
forward rather than replaced.

## The three problems this design exists to solve

### 1. Resumability

The browser can close at any moment. So the extension keeps **no local
queue**. Every send is committed to the backend as it happens; on startup the
extension asks what is still pending and picks up there.

### 2. Two tabs, one campaign

Two Gmail windows means two extension instances working the same campaign.
Without coordination they double-send, which is the single worst bug this
product can have.

Solved with a lease: claiming work is an atomic `UPDATE` under
`SELECT ... FOR UPDATE SKIP LOCKED` that stamps a `lease_id` and expiry onto
a batch of pending rows. A second client claiming simultaneously steps over
the locked rows and gets a different set. A client that dies mid-batch has
its lease expire, and the rows return to the pool — no cleanup job.

**SQLite does not support `SKIP LOCKED`.** Running on it gives you a claim
that appears to work while handing two clients the same recipients. Postgres
or MySQL 8+ only.

### 3. Quota accounting

Gmail counts recipients per account on a rolling 24h window, across all
campaigns. So the budget check cannot live in the extension and cannot live
on the campaign. It lives in `send_logs`, keyed by account. The extension
asks the backend how much budget an account has before sending. The backend
is the referee.

## Send loop

```
on startup, on alarm, and while a campaign is active:

  1. GET  /api/campaigns/{uuid}/state
     → still 'sending'? paused elsewhere?

  2. POST /api/campaigns/{uuid}/claim  { batch_size: 5 }
     → leased recipients, each with a mail_account_id already chosen by the
       backend's budget-weighted rotation
     → [] with retry_after_seconds if there is no budget right now

  3. for each leased recipient:
       render subject + body from templates and merge_data
       inject tracking pixel / rewrite links if enabled
       build RFC 2822 message, base64url encode
       POST gmail.googleapis.com/gmail/v1/users/me/messages/send
       sleep random(min_delay, max_delay) — but NOT after the last one,
         or results are reported up to max_delay late
       stop early if the lease is close to expiring

  4. POST /api/campaigns/{uuid}/results  { lease_id, results }
     → backend writes send_logs, updates recipients, refreshes counters
     → unused leases in the batch return to pending

  5. repeat
```

### When Gmail pushes back

Gmail throttles harder than its published caps and does not always warn you.
Treat these as a signal to back off the whole **account**, not to retry the
message:

- `429` / `rateLimitExceeded` / `userRateLimitExceeded`
- `403` with `dailyLimitExceeded`
- `5.4.5` in the error body

Stop the loop, report `rate_limited`, set `throttled_until`. Retrying the
same recipient immediately is how accounts get suspended rather than merely
slowed.

## API surface

Sanctum bearer token in `chrome.storage`, obtained from the exchange call.

```
POST   /api/auth/google/exchange   { code, code_verifier, redirect_uri }
POST   /api/auth/google/refresh    { refresh_token }
DELETE /api/auth/session

GET    /api/accounts
POST   /api/accounts
GET    /api/accounts/{id}/budget
POST   /api/accounts/{id}/throttle
DELETE /api/accounts/{id}

GET    /api/campaigns
POST   /api/campaigns
GET    /api/campaigns/{uuid}
PATCH  /api/campaigns/{uuid}
DELETE /api/campaigns/{uuid}
POST   /api/campaigns/{uuid}/recipients   (chunked, 1000 max per call)
POST   /api/campaigns/{uuid}/start
POST   /api/campaigns/{uuid}/pause
GET    /api/campaigns/{uuid}/state
POST   /api/campaigns/{uuid}/claim
POST   /api/campaigns/{uuid}/results
```

Not built yet: the public tracking routes (`/t/o/{token}.gif`,
`/t/c/{token}`, `/u/{token}`). Serve them from somewhere cheap and separate —
a Cloudflare Worker writing to the same database — so a scraped pixel URL
cannot take down the API.

## Extension layout

```
src/
├── background/          service worker — no DOM, holds all credentials
│   ├── index.js         message router, alarms, campaign creation
│   ├── auth.js          OAuth + PKCE, token storage, scope escalation
│   ├── api.js           fetch wrapper for the Laravel API
│   └── sender.js        the send loop, MIME building, rate-limit handling
├── content/             injected into mail.google.com
│   ├── index.js         floating launcher, mounts the panel in a shadow root
│   ├── Composer.vue     campaign form
│   ├── RichEditor.vue   contenteditable editor
│   └── panel-styles.js  panel CSS as a JS template literal
├── lib/                 pure functions, no chrome.* access
│   ├── parse-recipients.js
│   └── google-sheets.js
├── popup/               toolbar click (stub)
└── options/             settings page
```

Three constraints that shaped this:

**Shadow DOM.** Gmail ships aggressive global CSS that would shred any
injected UI, and our styles would leak back. Everything visible lives in a
shadow root.

**Panel CSS is a JS module, not a `.css` file.** `?inline` and `?raw` both
returned empty in the CRXJS content-script build — the CSS gets extracted to
an asset the shadow root never loads. A template literal cannot be lost by a
build step.

**The launcher is floating, not anchored to Gmail's sidebar.** The compose
button's `gh="cm"` attribute was stable for years and then wasn't. Anchoring
to Gmail's markup means the button silently vanishes on a redesign, which
users experience as "the extension stopped working."

## Deliberately not in v1

- Server-side sending, and therefore refresh token storage
- Reply detection and threading (restricted scope — see above)
- Drip sequences and follow-ups
- Reusable template library
- Bounce processing
- Open/click tracking endpoints (schema exists, routes do not)

## Things that bite

- **Unsubscribe is not optional.** Every send needs a working opt-out and a
  `List-Unsubscribe` header.
- **Mass assignment.** Models write `status`, `lease_id`, `sent_at`,
  `throttled_until` and friends from services. If a field is missing from
  `$fillable`, Eloquent drops it silently and the send appears to succeed
  while nothing is recorded.
- **Enum casts and `pluck`.** `refreshCounters()` needs `->toBase()` or the
  status cast turns grouped keys into enum objects and every lookup misses.
- **Merge field escaping.** `merge_data` comes from a user's spreadsheet and
  lands in an HTML body. Escape on render.
- **The unique index on `(campaign_id, email)`** is the only real defence
  against a duplicate import doubling someone's quota burn.