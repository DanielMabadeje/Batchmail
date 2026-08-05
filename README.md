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

## What's in v1

- Compose campaigns without leaving Gmail
- Recipients by pasting spreadsheet cells or importing a Google Sheets link
- Every column becomes a merge field, usable in the subject and body
- A small rich text editor — bold, italic, lists, links
- Paced sending with jitter, and automatic backoff when Gmail pushes back
- Multiple connected accounts, with work spread by remaining quota
- Campaigns resume where they left off after a browser restart

Not built yet: sending with the browser closed, scheduling and drip
sequences, reply detection, bounce processing. Open and click tracking has a
schema but no endpoints.

## Getting started

**[docs/setup.md](docs/setup.md)** walks through the whole thing — Google
Cloud project, backend, extension, and first send. About 30 minutes.

You'll need Node 20+, PHP 8.2+, and PostgreSQL or MySQL 8+. Not SQLite; the
setup guide explains why that one matters.

## Repo layout

```
batchmail/
├── api/          Laravel backend — campaigns, pacing, quota accounting
├── extension/    Chrome extension — Vue + Vite, does the sending
└── docs/
    ├── setup.md          how to run your own instance
    └── architecture.md   how it works and why
```

[`docs/architecture.md`](docs/architecture.md) explains the client/server
split, the lease mechanism that stops two open Gmail tabs from double-sending
the same recipient, and the full API surface. Worth reading before changing
anything in the send path.

## A note on scopes

Batchmail asks for `gmail.send` and, only when you import a Sheets link,
`spreadsheets.readonly`. Both are classified sensitive rather than
restricted — no third-party security audit, and no access to read your
mailbox.

It will never request `gmail.readonly`, `gmail.modify`, or
`mail.google.com`. Those would allow reading everything in your inbox, and
would commit the project to an annual paid security assessment.

## Contributing

Issues and PRs welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). If you're
changing the send loop or the claim/lease logic, read the architecture doc
first; the concurrency story there is load-bearing.

## Licence

MIT