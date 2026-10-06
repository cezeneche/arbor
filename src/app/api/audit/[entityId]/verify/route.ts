import { NextRequest } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { requireAuth } from '@/lib/auth-helpers'
import { ok, err } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { verifyChain } from '@/lib/layer2/audit-chain'
import type { AuditPayload } from '@/lib/layer2/audit-chain'
import { auditPayloadMismatches } from '@/lib/layer2/audit-record-match'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ entityId: string }> }) {
  const { session, response } = await requireAuth()
  if (!session) return response!

  const sessionEntityId = getSessionUser(session).entityId as string
  const { entityId } = await params

  if (sessionEntityId !== entityId) return err('Access denied', 'FORBIDDEN', 403)

  const [entries, records] = await Promise.all([
    prisma.auditEntry.findMany({
      where: { entityId },
      orderBy: { sequence: 'asc' },
    }),
    prisma.dataRecord.findMany({
      where: { entityId },
      select: {
        id: true,
        domain: true,
        fieldName: true,
        value: true,
        unit: true,
        originalValue: true,
        originalUnit: true,
        periodStart: true,
        periodEnd: true,
        trustTier: true,
        confidenceScore: true,
        sourceText: true,
        documentId: true,
        extractionMethod: true,
        submittedById: true,
      },
    }),
  ])

  const recordMap = new Map(records.map(r => [r.id, r]))

  const chainEntries = entries.map(e => ({
    eventType: e.eventType,
    hash: e.hash,
    previousHash: e.previousHash,
    payload: e.payload as unknown as AuditPayload,
  }))

  const chainValid = verifyChain(chainEntries)

  // Cross-check each audit entry's payload against the live DataRecord.
  // Skip synthetic entries (consent, batch tombstones) whose recordId is not a DataRecord id.
  const tampered: string[] = []
  for (const entry of chainEntries) {
    const p = entry.payload
    const record = recordMap.get(p.recordId)
    if (!record) {
      // Synthetic entries (e.g. consent_, batch_) legitimately have no DataRecord
      if (!p.recordId.startsWith('consent_') && !p.recordId.startsWith('batch_')) {
        tampered.push(`${p.recordId}: record missing from database`)
      }
      continue
    }
    const mismatches = auditPayloadMismatches(entry.eventType, p, record)
    if (mismatches.length > 0) {
      tampered.push(`${p.recordId}: fields altered — ${mismatches.join(', ')}`)
    }
  }

  const verified = chainValid && tampered.length === 0

  return ok({
    verified,
    chainValid,
    recordTamperCount: tampered.length,
    tampered: tampered.length > 0 ? tampered : undefined,
    entryCount: entries.length,
  })
}
