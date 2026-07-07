import { NextRequest } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/auth-helpers'
import { ok, err } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { merkleRoot } from '@/lib/layer2/merkle'
import { evaluatePredicate, statementDigest, type EvalRecord, type Predicate } from '@/lib/zk/predicate'
import { PENDING_ENGINE } from '@/lib/zk/proof'

// the ZK predicate statement surface (ADMIN). Given an entity and a
// compliance predicate, commit the entity's records with a Merkle root
// and return the public statement digest a proof would attest to,
// plus the admin-only (prover-side) evaluation. This is the "what is proven,
// against which commitment" layer; the Groth16/Halo2 proving engine is a
// deferred build (engine: pending). Read-only, off any write path.
const predicateSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('numeric_inequality'),
    field: z.string(),
    aggregate: z.enum(['sum', 'mean', 'max']),
    op: z.enum(['<', '<=', '>', '>=']),
    threshold: z.number(),
  }),
  z.object({
    kind: z.literal('set_membership'),
    field: z.string(),
    forbidden: z.array(z.string()),
  }),
  z.object({
    kind: z.literal('weighted_sum_threshold'),
    numeratorField: z.string(),
    denominatorField: z.string(),
    op: z.enum(['<', '<=', '>', '>=']),
    threshold: z.number(),
  }),
])
const bodySchema = z.object({ entityId: z.string().min(1), predicate: predicateSchema })

export async function POST(req: NextRequest) {
  const { session, response } = await requireAdmin()
  if (!session) return response!

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return err('Invalid request body', 'VALIDATION_ERROR', 400)
  const { entityId, predicate } = parsed.data as { entityId: string; predicate: Predicate }

  // Commit the entity's active records (same ordering as the audit package).
  const records = await prisma.dataRecord.findMany({
    where: { entityId, isActive: true },
    select: { auditHash: true, fieldName: true, value: true },
    orderBy: { submittedAt: 'asc' },
  })
  if (records.length === 0) {
    return ok({ status: 'noop', reason: 'no active records for entity', entityId })
  }

  const root = merkleRoot(records.map(r => r.auditHash))
  const statement = { merkleRoot: root, predicate }
  const digest = statementDigest(statement)

  // Witness (prover-side, admin-only): the records the future proof would range over.
  const witness: EvalRecord[] = records.map(r => ({ field: r.fieldName, value: r.value }))
  const evaluation = evaluatePredicate(predicate, witness)

  return ok({
    status: 'ok',
    entityId,
    merkleRoot: root,
    recordCount: records.length,
    predicate,
    // The public commitment a zero-knowledge proof would attest to.
    statementDigest: digest,
    // The proving engine is a deferred build; nothing here is a ZK proof yet.
    engine: { name: PENDING_ENGINE, available: false },
    // Prover-side result (admin only) — NOT part of the public statement.
    evaluation: { satisfied: evaluation.satisfied, observed: evaluation.observed, detail: evaluation.detail },
  })
}
