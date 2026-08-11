import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-helpers'
import { checkCbamScope } from '@/lib/nucleos/scope-client'
import { lookupDefaultValues } from '@/lib/nucleos/default-value-client'

// Scope-check proxy. The browser posts here; Arbor calls Nucleos server-side.
//
// Authenticated: this sits inside the portal, unlike the public supplier form.

export async function POST(request: Request) {
  const { session, response } = await requireAuth()
  if (!session) return response!

  let body: { cn_code?: unknown; origin_country?: unknown; consignment_value_eur?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Enter a commodity code and try again.' }, { status: 400 })
  }

  const cnCode = String(body.cn_code ?? '').replace(/\s/g, '')
  if (!/^\d{6,10}$/.test(cnCode)) {
    return NextResponse.json(
      { error: 'A commodity code is 6 to 10 digits. Check the code on your customs paperwork.' },
      { status: 400 },
    )
  }

  try {
    const result = await checkCbamScope({
      cn_code: cnCode,
      origin_country:
        typeof body.origin_country === 'string' && body.origin_country.trim()
          ? body.origin_country.trim().toUpperCase()
          : null,
      consignment_value_eur:
        typeof body.consignment_value_eur === 'number' && Number.isFinite(body.consignment_value_eur)
          ? body.consignment_value_eur
          : null,
    })
    // The default SEE comes from a second lookup because the scope endpoint does
    // not return it. Fetched here rather than in the browser so one user action
    // stays one request, and so a lookup failure degrades to "no estimate"
    // instead of failing the scope answer, which is the part that matters.
    let defaultSee: number | null = null
    if (result.status === 'in_scope') {
      try {
        const entries = await lookupDefaultValues(cnCode)
        defaultSee = entries[0]?.default_see_tco2e_per_t ?? null
      } catch {
        defaultSee = null
      }
    }

    return NextResponse.json({ ...result, default_see_tco2e_per_t: defaultSee })
  } catch {
    return NextResponse.json(
      { error: 'The scope check is unavailable right now. Please try again shortly.' },
      { status: 502 },
    )
  }
}
