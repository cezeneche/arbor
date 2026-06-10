// Layer 2  -  write path for institutional partner expressions of interest.
// Public endpoint  -  no auth required. Writes to InstitutionalEnquiry table only.
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

const VALID_INTEREST_AREAS = ['BENCHMARKS', 'DATA_PARTNERSHIP', 'POLICY', 'OTHER'] as const

export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 })
  }

  const { orgName, contactName, email, role, interestArea, message } = body as Record<string, string>

  if (!orgName?.trim()) return NextResponse.json({ error: 'Organisation name is required.' }, { status: 422 })
  if (!contactName?.trim()) return NextResponse.json({ error: 'Contact name is required.' }, { status: 422 })
  if (!email?.trim() || !email.includes('@')) return NextResponse.json({ error: 'A valid email address is required.' }, { status: 422 })
  if (!interestArea || !VALID_INTEREST_AREAS.includes(interestArea as typeof VALID_INTEREST_AREAS[number])) {
    return NextResponse.json({ error: 'Interest area must be one of: Benchmarks, Data partnership, Policy, Other.' }, { status: 422 })
  }

  await prisma.institutionalEnquiry.create({
    data: {
      orgName: orgName.trim(),
      contactName: contactName.trim(),
      email: email.trim().toLowerCase(),
      role: role?.trim() || null,
      interestArea,
      message: message?.trim() || null,
    },
  })

  return NextResponse.json({ ok: true }, { status: 201 })
}
