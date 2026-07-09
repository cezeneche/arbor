# Inbound email — webhook contract

Arbor accepts email at two recipient patterns on the inbound domain. Both are
delivered to a **single** webhook; the handler branches on the recipient address.

| Recipient pattern | Purpose | Handler branch |
|---|---|---|
| `upload-<token>@arbor.io` | Attachments become documents and run extraction (Gap 8.4). | `email/inbound` Inngest event |
| `requests-<token>@arbor.io` | The email body is parsed as a data request and matched against stored records, then **held for the supplier to review and send** — nothing is disclosed automatically (Core 5). | `request/inbound` Inngest event |

`<token>` is the entity's `uploadEmailToken`. The same token serves both patterns.
A supplier sees their two addresses on `/upload` and `/inbound-requests`.

## Endpoint

```
POST https://<your-production-domain>/api/inbound-email
```

This route is public (listed in `proxy.ts`) — it authenticates with an HMAC
signature over the request body, not a session and not a static token.

### Authentication

Every request MUST include an HMAC-SHA256 of the **raw JSON body**, keyed by
`INBOUND_EMAIL_WEBHOOK_SECRET`, as a lowercase hex string:

```
x-inbound-signature: <hex(HMAC-SHA256(INBOUND_EMAIL_WEBHOOK_SECRET, rawBody))>
```

The handler recomputes the HMAC over the exact bytes it received and compares
constant-time. Signing the body (rather than sending a static secret header)
means a captured header cannot be replayed with a different payload. A missing
signature, a mismatch, or an unset secret returns
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

Always responds `200 {"ok":true}` once the signature is valid (even for unknown
tokens or empty bodies) so the provider does not retry. Unknown tokens are
dropped downstream in the Inngest functions.

## Provider configuration checklist

1. **MX records** for the inbound domain (`arbor.io` or the chosen subdomain)
   point to the provider's inbound servers.
2. **Inbound route is a catch-all / wildcard** on the domain so it captures
   `requests-*` and not only `upload-*`.
3. **Webhook URL** = `https://<production-domain>/api/inbound-email`.
4. **Body HMAC signature** in the `x-inbound-signature` header —
   `hex(HMAC-SHA256(INBOUND_EMAIL_WEBHOOK_SECRET, rawBody))`. If the provider
   cannot sign the body, place a signing proxy in front of the webhook.
5. **Payload mapping** forwards `to`, `fromEmail`, `subject`, `text`, and (for
   uploads) `attachments` in the JSON shape above.

## Confirming it works

**App side (no provider needed)** — proves the route + secret + parsing. Use the
literal secret value (not an unset shell variable):

```bash
SECRET='PASTE_THE_ACTUAL_SECRET'
BODY='{"to":"requests-<token>@arbor.io","fromEmail":"buyer@example.com","subject":"Data request","text":"Please send your total electricity consumption for Q1 2026."}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | sed 's/^.* //')

curl -i -X POST https://<production-domain>/api/inbound-email \
  -H "Content-Type: application/json" \
  -H "x-inbound-signature: $SIG" \
  --data-raw "$BODY"
```

The signature must be computed over the **exact** bytes sent (`--data-raw "$BODY"`
sends `$BODY` verbatim; `printf '%s'` avoids a trailing newline).

- `200 {"ok":true}` → route + signature OK. A real `<token>` then creates an
  `InboundRequest` (visible on `/inbound-requests`); `parse-inbound-request`
  runs (visible in the Inngest dashboard) and the request becomes `NEEDS_DATA` —
  either **held for your review** (matching records found, ready to send) or
  awaiting data (nothing matched). Nothing is emailed to the sender automatically.
- `401` → the `x-inbound-signature` HMAC does not match (wrong secret, or the
  signed bytes differ from the bytes sent).

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
| `RESEND_API_KEY` | Transactional email (notifications). Not used to answer inbound requests — those are held for supplier review, never auto-sent. |
| `NEXT_PUBLIC_APP_URL` | Links in outgoing/notification emails. |
| `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` | Running the inbound Inngest functions. |
