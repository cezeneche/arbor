// Layer 2  -  updates entity's allowBenchmarkAggregation flag.
// Logs consent grant/revocation in the audit chain for traceability (PRD §19.3).
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { computeRecordHash } from '@/lib/layer2/audit-chain'
import type { AuditPayload } from '@/lib/layer2/audit-chain'
import type { Prisma } from '@prisma/client'

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const entityId = (session.user as Record<string, unknown>).entityId as string
  const userId = (session.user as Record<string, unknown>).id as string

  let body: { allow: boolean }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (typeof body.allow !== 'boolean') {
    return NextResponse.json({ error: "'allow' must be boolean" }, { status: 400 })
  }

  await prisma.entity.update({
    where: { id: entityId },
    data: { allowBenchmarkAggregation: body.allow },
  })

  const lastEntry = await prisma.auditEntry.findFirst({
    where: { entityId },
    orderBy: { createdAt: 'desc' },
    select: { hash: true },
  })

  // recordId is assigned once and reused for both hash computation and storage.
  const recordId = `consent_${Date.now()}`

  const now = new Date().toISOString()
  const payload: AuditPayload = {
    recordId,
    entityId,
    domain: 'COMPLIANCE',
    fieldName: 'benchmark_aggregation_consent',
    value: body.allow ? 1 : 0,
    unit: 'boolean',
    originalValue: body.allow ? 1 : 0,
    originalUnit: 'boolean',
    periodStart: now,
    periodEnd: now,
    trustTier: 'B',
    confidenceScore: 1.0,
    sourceText: null,
    documentId: null,
    extractionMethod: 'MANUAL_ENTRY',
    submittedAt: now,
    submittedById: userId,
  }
  const hash = computeRecordHash(payload, lastEntry?.hash ?? null)

  await prisma.auditEntry.create({
    data: {
      entityId,
      recordId,
      eventType: body.allow ? 'BENCHMARK_CONSENT_GRANTED' : 'BENCHMARK_CONSENT_REVOKED',
      payload: payload as unknown as Prisma.InputJsonValue,
      hash,
      previousHash: lastEntry?.hash ?? null,
    },
  })

  return NextResponse.json({ allowBenchmarkAggregation: body.allow })
}
