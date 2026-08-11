import { NextResponse } from 'next/server'
import { requirePageSession } from '@/lib/page-auth'
import { NucleosUnavailableError, isNucleosConfigured } from '@/lib/nucleos/extraction-client'

// Previews a carbon price relief claim. Calculation only — nothing is written.
//
// The formula lives in Nucleos and is not reimplemented here. A second copy in
// TypeScript would eventually disagree with the one that produces the filed
// return, and the disagreement would surface as a number the user had already
// seen and trusted.

export async function POST(request: Request) {
  await requirePageSession()

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Check the figures and try again.' }, { status: 400 })
  }

  try {
    if (!isNucleosConfigured()) throw new NucleosUnavailableError('not configured')
    const res = await fetch(`${process.env.NUCLEOS_URL}/api/cbam/cpr/calculate`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${process.env.NUCLEOS_INTERNAL_TOKEN as string}`,
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    })
    if (res.status === 422) {
      // The engine rejected the inputs. Its reasons are the useful part.
      const detail = await res.json().catch(() => null)
      return NextResponse.json(
        { error: 'These figures do not make a valid claim.', detail },
        { status: 422 },
      )
    }
    if (!res.ok) throw new NucleosUnavailableError(`cpr calculate failed: ${res.status}`)
    return NextResponse.json(await res.json())
  } catch {
    return NextResponse.json(
      { error: 'The relief could not be calculated right now. Please try again shortly.' },
      { status: 502 },
    )
  }
}
