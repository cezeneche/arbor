#!/usr/bin/env node
// Signs and sends a test inbound-email webhook, and doubles as the reference
// implementation for whatever sits in front of the endpoint.
//
// Neither Postmark nor SendGrid can compute a custom HMAC over the body they
// send, so a signing step has always been required between the provider and
// Arbor. The signature now covers `${timestamp}.${rawBody}` rather than the body
// alone: a body-only signature never expires, so one captured delivery could be
// replayed for ever. The timestamp is inside the signed material, so it cannot
// be moved to make an old capture look fresh.
//
//   node scripts/sign-inbound-email.mjs --url <endpoint> --secret <secret> [--body <file>] [--print]
//
// --print writes the headers and body instead of sending, for pasting elsewhere.

import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'

function arg(name, fallback = undefined) {
  const i = process.argv.indexOf(`--${name}`)
  if (i === -1) return fallback
  const value = process.argv[i + 1]
  return value && !value.startsWith('--') ? value : true
}

const url = arg('url')
const secret = arg('secret') ?? process.env.INBOUND_EMAIL_WEBHOOK_SECRET
const bodyFile = arg('body')
const printOnly = arg('print') === true

if (!url || !secret) {
  console.error(
    'Usage: node scripts/sign-inbound-email.mjs --url <endpoint> --secret <secret> [--body <file>] [--print]\n' +
      '       --secret may instead come from INBOUND_EMAIL_WEBHOOK_SECRET.',
  )
  process.exit(2)
}

// A harmless default: an unroutable token, so a real inbound request is not
// created. Swap in a real `requests-<token>@…` address for an end-to-end check.
const defaultBody = JSON.stringify({
  to: 'requests-signaturecheck@arbor.io',
  fromEmail: 'buyer@example.com',
  subject: 'Signature check',
  text: 'This is a signature check, not a real data request.',
})

const rawBody = bodyFile ? readFileSync(bodyFile, 'utf8') : defaultBody

// ── The two lines a signing proxy needs ──────────────────────────────────────
const timestamp = Math.floor(Date.now() / 1000).toString()
const signature = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')
// ─────────────────────────────────────────────────────────────────────────────

const headers = {
  'Content-Type': 'application/json',
  'x-inbound-timestamp': timestamp,
  'x-inbound-signature': signature,
}

if (printOnly) {
  for (const [k, v] of Object.entries(headers)) console.log(`${k}: ${v}`)
  console.log('')
  console.log(rawBody)
  process.exit(0)
}

const res = await fetch(url, { method: 'POST', headers, body: rawBody })
const text = await res.text()

console.log(`POST ${url}`)
console.log(`→ ${res.status} ${text}`)
console.log('')

if (res.status === 200) {
  console.log('OK — the endpoint accepted the signature.')
} else if (res.status === 401) {
  console.log(
    'Rejected. Either the secret does not match production, or the clock is more\n' +
      'than 10 minutes out, or the signed bytes differ from the bytes sent.',
  )
} else if (res.status === 503) {
  console.log('INBOUND_EMAIL_WEBHOOK_SECRET is not set on the deployment.')
}

process.exit(res.status === 200 ? 0 : 1)
