# Alert messages

Every message Arbor or Nucleos posts to Slack, and every operations email, is
built from one structure and rendered one way. Arbor renders Slack and email in
`src/lib/alerts/format.ts`; Nucleos renders Slack in
`nucleos/api/ledger_app/services/alert_format.py`. Both are tested against
`golden.json` in this folder, so the two cannot drift apart. Change the format
here first.

Where alerts come from:

- Arbor's own (`src/lib/alerts/send.ts`): keepalive failures, extraction drift,
  the Nucleos token expiry, new enquiries.
- Sentry, for errors in either system: its alert rules post to Arbor's
  `/api/alerts/sentry`, which sends them in this format.
- Nucleos's case workflow (review required, a failed pipeline step), straight to
  its own Slack webhook.

## The structure

| Field         | Rule                                                                                                                                                              |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `severity`    | `critical` (someone must act now), `warning` (act soon), `info` (worth knowing), `resolved` (an earlier alert is over).                                           |
| `source`      | The system that raised it: `Arbor`, `Nucleos`.                                                                                                                    |
| `environment` | `production`, `preview`, `development`.                                                                                                                           |
| `title`       | What is wrong or what happened, as a short sentence in sentence case with no full stop: "Sign-in is failing", not "ERROR: Auth Failure!". At most 150 characters. |
| `summary`     | One or two plain sentences: what happened and what it affects. No stack traces, no raw error dumps.                                                               |
| `facts`       | Up to 10 label/value pairs a reader needs to judge it: service, count, since when. Labels in sentence case.                                                       |
| `action`      | What to do next, as one instruction. Omit it rather than write "investigate".                                                                                     |
| `link`        | The one place to act, as a button: the case, the Sentry issue, the review page. A label saying where it goes ("Open the case"), never "Click here".               |
| `ref`         | A reference to search logs by: run ID, issue ID, cron path.                                                                                                       |
| `at`          | When it happened. Shown in UTC as `17 Oct 2026, 14:03 UTC`.                                                                                                       |

## How it looks in Slack

```
🔴 Action needed · Arbor · production
Sign-in is failing
The rate limiter cannot reach Redis, so every sign-in is refused.
Service           Since
Upstash Redis     17 Oct 2026, 13:58 UTC
What to do
Check the Upstash database still exists in Vercel → Storage.
[ Open readiness ]
17 Oct 2026, 14:03 UTC · ref cron/keepalive
```

- Severity markers: 🔴 Action needed, 🟠 Warning, 🔵 Update, 🟢 Resolved. Nothing else uses emoji.
- The notification preview (Slack's `text`) is `<label>: <title>`, so a phone lock screen says enough.
- Any text that came from outside the code (organisation names, error messages) has `&`, `<` and `>` escaped, so it can never ping `@channel` or forge a link.
- No colour bars: they need Slack's legacy attachments. The marker carries the severity.

## Email

Sent by Arbor only. Subject `[<source>] <label>: <title>`, with the environment
after the source when it is not production. Plain HTML in the same order as
Slack, plus a plain-text part. Critical and warning alerts are emailed to
platform admins; info and resolved go to Slack only.

## What stays out of messages

Contact details, document contents and figures from customer records stay in
Arbor. A message names the organisation or case and links to it.
