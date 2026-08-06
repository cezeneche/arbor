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

async function tierOf(entityId: string): Promise<PlanTier | null> {
  const entity = await prisma.entity.findUnique({
    where: { id: entityId },
    select: { planTier: true },
  })
  return (entity?.planTier as PlanTier) ?? null
}

function startOfMonthUtc(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
}

/** Gate a document upload against the entity's tier + monthly upload count. */
export async function assertUploadAllowed(entityId: string): Promise<LimitCheck> {
  const tier = await tierOf(entityId)
  if (!tier) return { allowed: true }
  const uploadsThisMonth = await prisma.document.count({
    where: { entityId, submittedAt: { gte: startOfMonthUtc() } },
  })
  return checkUploadAllowed(tier, uploadsThisMonth)
}

/** Gate writing `adding` new records against the entity's active-record cap. */
export async function assertRecordCapacity(entityId: string, adding: number): Promise<LimitCheck> {
  const tier = await tierOf(entityId)
  if (!tier) return { allowed: true }
  const active = await prisma.dataRecord.count({ where: { entityId, isActive: true } })
  return checkRecordCapacity(tier, active, adding)
}

/** Gate a buyer starting a request to a supplier against their connection cap.
 *  A supplier they already have any request with never counts as new. */
export async function assertSupplierConnection(
  buyerEntityId: string,
  supplierEntityId: string,
): Promise<LimitCheck> {
  const tier = await tierOf(buyerEntityId)
  if (!tier) return { allowed: true }
  const connected = await prisma.dataRequest.findMany({
    where: { buyerEntityId },
    select: { supplierEntityId: true },
    distinct: ['supplierEntityId'],
  })
  const alreadyConnected = connected.some((c) => c.supplierEntityId === supplierEntityId)
  return checkSupplierConnection(tier, connected.length, alreadyConnected)
}

/** Gate audit package generation against the entity's plan (PRD §22.4). */
export async function assertAuditPackageAllowed(entityId: string): Promise<LimitCheck> {
  const tier = await tierOf(entityId)
  if (!tier) return { allowed: true }
  return checkAuditPackageAllowed(tier)
}
