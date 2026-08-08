// DB-backed plan-limit checks. Thin wrappers that count current usage and defer
// the decision to the pure rules in plan-limits.ts. Fail OPEN on a missing
// entity (the route's own auth/404 handling covers that case better than a
// misleading "plan limit" error).
import { prisma } from '@/lib/prisma'
import {
  checkUploadAllowed,
  checkRecordCapacity,
  checkSupplierConnection,
  checkAuditPackageAllowed,
  type LimitCheck,
  type PlanTier,
} from '@/lib/plan-limits'

/** The subset of the client these checks need, so a caller inside a serializable
 *  transaction can pass its `tx` and have the count and the write settled
 *  together. Counting on the shared client and then writing in a transaction is a
 *  check-then-act: two requests both count 499 against a cap of 500 and both
 *  write. Counting inside the transaction makes Postgres treat that as the
 *  conflict it is, and runSerializable retries the loser. */
export type PlanGuardClient = {
  entity: { findUnique: typeof prisma.entity.findUnique }
  dataRecord: { count: typeof prisma.dataRecord.count }
  document: { count: typeof prisma.document.count }
  dataRequest: { findMany: typeof prisma.dataRequest.findMany }
}

async function tierOf(entityId: string, client: PlanGuardClient): Promise<PlanTier | null> {
  const entity = await client.entity.findUnique({
    where: { id: entityId },
    select: { planTier: true },
  })
  return (entity?.planTier as PlanTier) ?? null
}

function startOfMonthUtc(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
}

/** Gate a document upload against the entity's tier + monthly upload count. */
export async function assertUploadAllowed(
  entityId: string,
  client: PlanGuardClient = prisma,
): Promise<LimitCheck> {
  const tier = await tierOf(entityId, client)
  if (!tier) return { allowed: true }
  const uploadsThisMonth = await client.document.count({
    where: { entityId, submittedAt: { gte: startOfMonthUtc() } },
  })
  return checkUploadAllowed(tier, uploadsThisMonth)
}

/** Gate writing `adding` new records against the entity's active-record cap.
 *  Pass the transaction client when calling from inside one — see PlanGuardClient. */
export async function assertRecordCapacity(
  entityId: string,
  adding: number,
  client: PlanGuardClient = prisma,
): Promise<LimitCheck> {
  const tier = await tierOf(entityId, client)
  if (!tier) return { allowed: true }
  const active = await client.dataRecord.count({ where: { entityId, isActive: true } })
  return checkRecordCapacity(tier, active, adding)
}

/** Gate a buyer starting a request to a supplier against their connection cap.
 *  A supplier they already have any request with never counts as new. */
export async function assertSupplierConnection(
  buyerEntityId: string,
  supplierEntityId: string,
  client: PlanGuardClient = prisma,
): Promise<LimitCheck> {
  const tier = await tierOf(buyerEntityId, client)
  if (!tier) return { allowed: true }
  const connected = await client.dataRequest.findMany({
    where: { buyerEntityId },
    select: { supplierEntityId: true },
    distinct: ['supplierEntityId'],
  })
  const alreadyConnected = connected.some((c) => c.supplierEntityId === supplierEntityId)
  return checkSupplierConnection(tier, connected.length, alreadyConnected)
}

/** Gate audit package generation against the entity's plan (PRD §22.4). */
export async function assertAuditPackageAllowed(
  entityId: string,
  client: PlanGuardClient = prisma,
): Promise<LimitCheck> {
  const tier = await tierOf(entityId, client)
  if (!tier) return { allowed: true }
  return checkAuditPackageAllowed(tier)
}
