import { NextResponse } from 'next/server'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { getClientIp } from '@/lib/rate-limit-pure'
import {
  submitSupplierForm,
  SupplierTokenInvalidError,
} from '@/lib/nucleos/supplier-form-client'

// Submission proxy for the public supplier form.
//
// The browser posts here, not to Nucleos. Nucleos has no browser-facing surface
// after Phase 2, and keeping it that way means the supplier's browser never
// learns the service exists.
//
// Deliberately unauthenticated: the supplier has no Arbor account. The URL token
// is the credential, and Nucleos validates it — this route does not try to second
// guess that, it only refuses input that is obviously unusable. Being public, it
// is rate limited per IP.

// Well above any real product (grey hydrogen is around 12). Anything larger is a
// unit slip or junk, and Nucleos's own plausibility checks start from a sane figure.
const MAX_SEE_TCO2E_PER_T = 1000
const MAX_TEXT = 200
const MAX_TOKEN = 256

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const ip = getClientIp(request.headers.get('x-forwarded-for'), request.headers.get('x-real-ip'))
  const { allowed } = await checkRateLimit(RATE_LIMITS.supplierForm, ip)
  if (!allowed) {
    return NextResponse.json({ error: 'Too many attempts. Please try again later.' }, { status: 429 })
  }

  const { token } = await params
  if (!token || token.length > MAX_TOKEN) {
    return NextResponse.json({ error: 'This link is not valid.' }, { status: 404 })
  }

  let body: { see_tco2e_per_t?: unknown; production_route?: unknown; installation_name?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Please check the form and try again.' }, { status: 400 })
  }

  const intensity = Number(body.see_tco2e_per_t)
  if (!Number.isFinite(intensity) || intensity <= 0 || intensity > MAX_SEE_TCO2E_PER_T) {
    return NextResponse.json(
      { error: 'Enter the emissions figure in tonnes of CO2e per tonne of product, as a number greater than zero.' },
      { status: 400 },
    )
  }
  if (typeof body.production_route !== 'string' || !body.production_route.trim()) {
    return NextResponse.json({ error: 'Choose how the goods were produced.' }, { status: 400 })
  }
  if (
    body.production_route.length > MAX_TEXT ||
    (typeof body.installation_name === 'string' && body.installation_name.length > MAX_TEXT)
  ) {
    return NextResponse.json({ error: 'Please shorten the text and try again.' }, { status: 400 })
  }

  try {
    await submitSupplierForm(token, {
      see_tco2e_per_t: intensity,
      production_route: body.production_route.trim(),
      installation_name:
        typeof body.installation_name === 'string' && body.installation_name.trim()
          ? body.installation_name.trim()
          : null,
    })
    return NextResponse.json({ status: 'received' })
  } catch (err) {
    if (err instanceof SupplierTokenInvalidError) {
      return NextResponse.json({ error: err.message }, { status: 410 })
    }
    return NextResponse.json(
      { error: 'Your figure could not be saved. Please try again in a few minutes.' },
      { status: 502 },
    )
  }
}
