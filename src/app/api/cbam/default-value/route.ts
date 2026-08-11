import { NextResponse } from 'next/server'
import { requirePageSession } from '@/lib/page-auth'
import { lookupDefaultValues } from '@/lib/nucleos/default-value-client'

export async function GET(request: Request) {
  await requirePageSession()
  const q = new URL(request.url).searchParams.get('q') ?? ''
  try {
    return NextResponse.json({ results: await lookupDefaultValues(q) })
  } catch {
    return NextResponse.json(
      { error: 'The published default could not be looked up right now.' },
      { status: 502 },
    )
  }
}
