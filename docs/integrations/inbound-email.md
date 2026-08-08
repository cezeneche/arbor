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

Every request MUST carry **both** headers:

```
x-inbound-timestamp: <unix seconds>
x-inbound-signature: <hex(HMAC-SHA256(SECRET, `${timestamp}.${rawBody}`))>
```

keyed by `INBOUND_EMAIL_WEBHOOK_SECRET`, lowercase hex.

The timestamp is **inside the signed material**, not merely alongside it. A
signature over the body alone never expires, so one captured delivery could be
replayed indefinitely; binding the timestamp in means a replay is only accepted
within 10 minutes, and shifting the timestamp to widen that window invalidates
the signature. Within the window, an identical signed body is accepted exactly
once — a repeat returns `200 {"ok":true,"duplicate":true}` and is not processed
again.

The handler recomputes the HMAC over the exact bytes it received and compares
constant-time. A missing or unparseable timestamp, a missing signature, a
mismatch, a timestamp outside the window, or an unset secret returns
`401 {"error":"Unauthorized","code":"UNAUTHORIZED"}`. The route is reached
(check `x-matched-path: /api/inbound-email` on the response) but rejected.

> **Clock skew.** The signer's clock must be within 10 minutes of Arbor's. A
> signing proxy on a host with a drifting clock will fail every delivery with a
> 401 that looks exactly like a wrong secret.

### Size limits

A single message cannot decide how much work Arbor does. The route refuses a body
over 30 MB with `413`, accepts at most 20 attachments, and caps each attachment's
base64 payload at 15 MB. `fromEmail` must be a real address.

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
4. **Timestamped HMAC signature** in the `x-inbound-timestamp` and
   `x-inbound-signature` headers, as above. **Neither Postmark nor SendGrid can
   compute a custom HMAC over the body they send**, so a signing step between the
   provider and Arbor is required — it always was, and it is the piece to update
   for the timestamped contract. `scripts/sign-inbound-email.mjs` is the
   reference implementation; the whole of it is two lines:

   ```js
   const timestamp = Math.floor(Date.now() / 1000).toString()
   const signature = createHmac('sha256', SECRET).update(`${timestamp}.${rawBody}`).digest('hex')
   ```

   Forward those as the two headers with the body **unmodified** — the signature
   covers the exact bytes, so re-serialising the JSON after signing breaks it.
5. **Payload mapping** forwards `to`, `fromEmail`, `subject`, `text`, and (for
   uploads) `attachments` in the JSON shape above.

## Confirming it works

**App side (no provider needed)** — proves the route + secret + parsing. Use the
literal secret value (not an unset shell variable):

```bash
node scripts/sign-inbound-email.mjs \
  --url https://<production-domain>/api/inbound-email \
  --secret 'PASTE_THE_ACTUAL_SECRET'
```

That signs and sends a harmless probe. To send a real message, put the JSON in a
file and pass `--body <file>`; to get the headers for pasting elsewhere, add
`--print`.

Doing it by hand is easy to get wrong — the signature covers `${timestamp}.${body}`
over the **exact** bytes sent, so a shell that adds a trailing newline or a tool
that re-serialises the JSON produces a 401 indistinguishable from a bad secret:

```bash
SECRET='PASTE_THE_ACTUAL_SECRET'
BODY='{"to":"requests-<token>@arbor.io","fromEmail":"buyer@example.com","subject":"Data request","text":"Please send your total electricity consumption for Q1 2026."}'
TS=$(date +%s)
SIG=$(printf '%s' "$TS.$BODY" | openssl dgst -sha256 -hmac "$SECRET" | sed 's/^.* //')

curl -i -X POST https://<production-domain>/api/inbound-email \
  -H "Content-Type: application/json" \
  -H "x-inbound-timestamp: $TS" \
  -H "x-inbound-signature: $SIG" \
  --data-raw "$BODY"
```

- `200 {"ok":true}` → route + signature OK. A real `<token>` then creates an
  `InboundRequest` (visible on `/inbound-requests`); `parse-inbound-request`
  runs (visible in the Inngest dashboard) and the request becomes `NEEDS_DATA` —
  either **held for your review** (matching records found, ready to send) or
  awaiting data (nothing matched). Nothing is emailed to the sender automatically.
- `401` → the signature does not match. In order of likelihood: the signer was
  not updated to the timestamped contract; the secret differs from production;
  the signer's clock is more than 10 minutes out; or the signed bytes differ from
  the bytes sent.
- `413` → the body exceeded 30 MB.

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
