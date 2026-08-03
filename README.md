# Batchmail

Send batch email through your own Gmail account, paced so you don't get
throttled.

Batchmail is a Chrome extension plus a small Laravel backend. There is no
mail server and no third-party sending service — messages go out through the
Gmail API using your own account, at your own sending reputation.

## How it works

The extension does the sending. The backend keeps score.

Your Gmail credential never touches the server. The extension holds it
locally, calls the Gmail API directly, and reports outcomes back to the
backend, which tracks campaign progress and enforces pacing across your
connected accounts.

The trade-off: campaigns only progress while Chrome is open. That is
deliberate for v1 — it is what makes Batchmail free to run and keeps your
mailbox credential off anyone else's infrastructure.

## Limits, honestly

Google caps sending at roughly 500 recipients per day on a personal Gmail
account and 2,000 on paid Workspace, counted on a rolling 24-hour window
rather than a daily reset. Undocumented behavioural throttling kicks in well
below those ceilings — commonly around 20 sends per hour.

Batchmail paces sends to stay under those limits and backs off when Gmail
pushes back. It cannot raise them. If you need more volume, connect several
accounts and let Batchmail rotate between them, or use a dedicated email
service provider — that is the honest answer.

This is a tool for mail merge to people who expect to hear from you.

## Repo layout

```
batchmail/
├── api/          Laravel backend — campaigns, pacing, tracking
├── extension/    Chrome extension — Vue + Vite, does the sending
├── docs/         architecture and API contract
└── docker-compose.yml
```

Start with [`docs/architecture.md`](docs/architecture.md). It explains the
client/server split, the lease mechanism that stops two open tabs from
double-sending, and the full API surface.

## Running it yourself

You need a Google Cloud project with the Gmail API enabled and an OAuth
client of type **Chrome Extension**. While your OAuth app is in testing mode
you can add up to 100 test accounts and skip Google's verification process
entirely — enough to run this for yourself or a small team indefinitely.

Only request the `gmail.send` scope. It is classified sensitive rather than
restricted, which means no third-party security assessment. Adding
`gmail.readonly` or `gmail.modify` moves you into restricted scope territory
and an annual CASA audit. Don't.

### Backend

```bash
cp .env.example .env
docker compose up -d
docker compose exec api php artisan key:generate
docker compose exec api php artisan migrate
```

### Extension

```bash
cd extension
npm install
npm run build
```

Then load `extension/dist` as an unpacked extension at
`chrome://extensions` with developer mode on. Point it at your backend URL
in the options page.

## Status

Early. v1 scope is single-shot campaigns with CSV recipients, merge fields,
pacing, and open/click tracking. Not yet built: server-side sending, reply
detection, drip sequences, bounce processing.

## Contributing

Issues and PRs welcome. If you're changing anything about the send loop or
the claim/lease logic, read the architecture doc first — the concurrency
story there is load-bearing.

## Licence

MIT