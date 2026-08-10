import { NextResponse } from 'next/server'
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
// guess that, it only refuses input that is obviously unusable.

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params

  let body: { see_tco2e_per_t?: unknown; production_route?: unknown; installation_name?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Please check the form and try again.' }, { status: 400 })
  }

  const intensity = Number(body.see_tco2e_per_t)
  if (!Number.isFinite(intensity) || intensity <= 0) {
    return NextResponse.json(
      { error: 'Enter the emissions figure as a number greater than zero.' },
      { status: 400 },
    )
  }
  if (typeof body.production_route !== 'string' || !body.production_route.trim()) {
    return NextResponse.json({ error: 'Choose how the goods were produced.' }, { status: 400 })
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
