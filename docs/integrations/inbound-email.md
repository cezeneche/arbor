# Inbound email — webhook contract

Arbor accepts email at two recipient patterns on the inbound domain. Both are
delivered to a **single** webhook; the handler branches on the recipient address.

| Recipient pattern | Purpose | Handler branch |
|---|---|---|
| `upload-<token>@arbor.io` | Attachments become documents and run extraction (Gap 8.4). | `email/inbound` Inngest event |
| `requests-<token>@arbor.io` | The email body is parsed as a data request and auto-answered from stored records (Core 5). | `request/inbound` Inngest event |

`<token>` is the entity's `uploadEmailToken`. The same token serves both patterns.
A supplier sees their two addresses on `/upload` and `/inbound-requests`.

## Endpoint

```
POST https://<your-production-domain>/api/inbound-email
```

This route is public (listed in `proxy.ts`) — it authenticates with a shared
secret header, not a session.

### Authentication

Every request MUST include:

```
X-Inbound-Secret: <INBOUND_EMAIL_WEBHOOK_SECRET>
```

The handler compares it to the `INBOUND_EMAIL_WEBHOOK_SECRET` environment
variable. A missing/empty secret on either side, or any mismatch, returns
`401 {"error":"Unauthorized","code":"UNAUTHORIZED"}`. The route is reached
(check `x-matched-path: /api/inbound-email` on the response) but rejected.

### Request body (JSON)

The email provider must POST a JSON body normalised to this shape:

```json
{
  "to": "requests-abc123@arbor.io",
  "fromEmail": "buyer@example.com",
  "subject": "Q1 2026 data request",
  "text": "Please send your total electricity consumption for Q1 2026.",
  "attachments": [
    { "name": "bill.pdf", "contentType": "application/pdf", "contentBase64": "..." }
  ]
}
```

| Field | Used by | Notes |
|---|---|---|
| `to` | both | Determines which pattern/branch handles the message. |
| `fromEmail` | both | Reply-to for request answers; recorded on the `InboundRequest`. |
| `subject` | **requests** | Combined with `text` as the request body. |
| `text` | **requests** | The request body the model parses. Required — without it a request is recorded as `NEEDS_DATA` (nothing to parse). |
| `attachments` | **upload** | Required for the upload path; ignored for requests. |

> Providers (Postmark, SendGrid) send their own field names (e.g. Postmark
> `ToFull` / `TextBody`, SendGrid multipart `to` / `text`). Map them into the
> shape above — and for the requests path make sure `subject`/`text` are
> included, since the upload path historically only needed `to`/`fromEmail`/`attachments`.

Always responds `200 {"ok":true}` once the secret is valid (even for unknown
tokens or empty bodies) so the provider does not retry. Unknown tokens are
dropped downstream in the Inngest functions.

## Provider configuration checklist

1. **MX records** for the inbound domain (`arbor.io` or the chosen subdomain)
   point to the provider's inbound servers.
2. **Inbound route is a catch-all / wildcard** on the domain so it captures
   `requests-*` and not only `upload-*`.
3. **Webhook URL** = `https://<production-domain>/api/inbound-email`.
4. **Custom header** `X-Inbound-Secret` set to the production
   `INBOUND_EMAIL_WEBHOOK_SECRET` value.
5. **Payload mapping** forwards `to`, `fromEmail`, `subject`, `text`, and (for
   uploads) `attachments` in the JSON shape above.

## Confirming it works

**App side (no provider needed)** — proves the route + secret + parsing. Use the
literal secret value (not an unset shell variable):

```bash
curl -i -X POST https://<production-domain>/api/inbound-email \
  -H "Content-Type: application/json" \
  -H "X-Inbound-Secret: PASTE_THE_ACTUAL_SECRET" \
  -d '{"to":"requests-<token>@arbor.io","fromEmail":"buyer@example.com","subject":"Data request","text":"Please send your total electricity consumption for Q1 2026."}'
```

- `200 {"ok":true}` → route + auth OK. A real `<token>` then creates an
  `InboundRequest` (visible on `/inbound-requests`); `parse-inbound-request`
  runs (visible in the Inngest dashboard) and the request becomes `ANSWERED`
  (matching records exist) or `NEEDS_DATA`.
- `401` → the `X-Inbound-Secret` header does not match the env value (most often
  an empty/unset shell variable in the test command).

> Note: `vercel env pull` may write empty values depending on link mode, and
> Vercel "Sensitive" variables are write-only and cannot be read back via CLI or
> API. An empty pull does **not** mean the production value is empty — it is
> still injected at runtime. Use the value you set, or rotate the secret to a
> known value if it has been lost.

**End to end** — send a real email to `requests-<token>@arbor.io` with a request
in the body, then watch the provider's inbound activity log (delivered, 200),
the Inngest dashboard (`request/inbound` → `parse-inbound-request`), and
`/inbound-requests`.

## Required environment variables

| Variable | Needed for |
|---|---|
| `INBOUND_EMAIL_WEBHOOK_SECRET` | Authenticating the webhook (both paths). |
| `ANTHROPIC_API_KEY` | Parsing request emails into `{domain, fields, period}`. |
| `RESEND_API_KEY` | Sending the answer reply (request path). |
| `NEXT_PUBLIC_APP_URL` | Links in outgoing/notification emails. |
| `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` | Running the inbound Inngest functions. |
