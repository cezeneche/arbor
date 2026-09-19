import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-helpers'
import { lookupDefaultValues } from '@/lib/nucleos/default-value-client'

export async function GET(request: Request) {
  const { session, response } = await requireAuth()
  if (!session) return response!
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
