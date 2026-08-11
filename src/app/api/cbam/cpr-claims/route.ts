import { NextResponse } from 'next/server'
import { requireWriteAccess } from '@/lib/auth-helpers'
import { NucleosUnavailableError, isNucleosConfigured } from '@/lib/nucleos/extraction-client'

// Records a carbon price relief claim. This one writes.

export async function POST(request: Request) {
  const { session, response } = await requireWriteAccess()
  if (!session) return response!

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Check the figures and try again.' }, { status: 400 })
  }

  try {
    if (!isNucleosConfigured()) throw new NucleosUnavailableError('not configured')
    const res = await fetch(`${process.env.NUCLEOS_URL}/api/cbam/cpr/claims`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${process.env.NUCLEOS_INTERNAL_TOKEN as string}`,
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    })
    if (res.status === 422) {
      return NextResponse.json(
        { error: 'These figures do not make a valid claim.' },
        { status: 422 },
      )
    }
    if (!res.ok) throw new NucleosUnavailableError(`cpr claim failed: ${res.status}`)
    return NextResponse.json(await res.json(), { status: 201 })
  } catch {
    return NextResponse.json(
      { error: 'The claim could not be recorded right now. Please try again shortly.' },
      { status: 502 },
    )
  }
}
