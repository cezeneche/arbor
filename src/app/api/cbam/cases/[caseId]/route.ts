import { NextResponse } from 'next/server'
import { requirePageSession } from '@/lib/page-auth'
import { getCbamCase } from '@/lib/nucleos/cases-client'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ caseId: string }> },
) {
  await requirePageSession()
  const { caseId } = await params
  try {
    return NextResponse.json(await getCbamCase(caseId))
  } catch {
    return NextResponse.json({ error: 'This case could not be loaded.' }, { status: 502 })
  }
}
