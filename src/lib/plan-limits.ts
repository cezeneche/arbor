// Plan-tier limits, mirroring the public pricing page exactly. Pure and DB-free.
//
// PILOT is the default for every entity while Arbor is at demo/pilot stage —
// deliberately uncapped so no demo or pilot customer ever hits a wall. Paid-tier
// caps become real the moment an entity is assigned one (there is no self-serve
// tier change; assignment is an operator action until billing exists).
//
// One promise is enforced by *absence*: responding to a buyer's data request is
// always free for suppliers regardless of plan, so the public submission-link
// path is intentionally not capped.

export type PlanTier =
  | 'PILOT'
  | 'STARTER'
  | 'MICRO'
  | 'SMALL'
  | 'GROWTH'
  | 'STANDARD'
  | 'BUSINESS'
  | 'ENTERPRISE'

export interface PlanLimits {
  /** Cap on active DataRecords; null = unlimited. */
  maxActiveRecords: number | null
  /** Cap on document uploads per calendar month; null = unlimited. */
  maxUploadsPerMonth: number | null
  /** Buyer plans: cap on distinct connected supplier entities; null = unlimited. */
  maxSupplierConnections: number | null
  /** STARTER is declaration-only — no document uploads at all. */
  allowsUploads: boolean
  /**
   * Audit package generation (PRD §22.4 — a paid Phase 2 service, not a free
   * button). Metered per-entity-per-period billing does not exist yet, so this
   * is the entitlement seam rather than a real paywall: it gates who can
   * generate at all, and metering slots in here when billing lands.
   */
  allowsAuditPackage: boolean
}

export const PLAN_LIMITS: Record<PlanTier, PlanLimits> = {
  PILOT: { maxActiveRecords: null, maxUploadsPerMonth: null, maxSupplierConnections: null, allowsUploads: true, allowsAuditPackage: true },
  // Supplier plans (pricing page)
  // STARTER holds no documents, so a package whose whole value is document-backed
  // provenance would be an empty promise on it.
  STARTER: { maxActiveRecords: 5, maxUploadsPerMonth: 0, maxSupplierConnections: null, allowsUploads: false, allowsAuditPackage: false },
  MICRO: { maxActiveRecords: 500, maxUploadsPerMonth: 10, maxSupplierConnections: null, allowsUploads: true, allowsAuditPackage: true },
  SMALL: { maxActiveRecords: 2500, maxUploadsPerMonth: 50, maxSupplierConnections: null, allowsUploads: true, allowsAuditPackage: true },
  GROWTH: { maxActiveRecords: 10000, maxUploadsPerMonth: null, maxSupplierConnections: null, allowsUploads: true, allowsAuditPackage: true },
  // Buyer plans (pricing page)
  STANDARD: { maxActiveRecords: null, maxUploadsPerMonth: null, maxSupplierConnections: 10, allowsUploads: true, allowsAuditPackage: true },
  BUSINESS: { maxActiveRecords: null, maxUploadsPerMonth: null, maxSupplierConnections: 50, allowsUploads: true, allowsAuditPackage: true },
  ENTERPRISE: { maxActiveRecords: null, maxUploadsPerMonth: null, maxSupplierConnections: null, allowsUploads: true, allowsAuditPackage: true },
}

export interface LimitCheck {
  allowed: boolean
  reason?: string
}

export function checkUploadAllowed(tier: PlanTier, uploadsThisMonth: number): LimitCheck {
  const limits = PLAN_LIMITS[tier]
  if (!limits.allowsUploads) {
    return { allowed: false, reason: 'Your plan does not include document uploads. Upgrade to upload documents.' }
  }
  if (limits.maxUploadsPerMonth !== null && uploadsThisMonth >= limits.maxUploadsPerMonth) {
    return {
      allowed: false,
      reason: `You've reached your plan's limit of ${limits.maxUploadsPerMonth} document uploads this month.`,
    }
  }
  return { allowed: true }
}

export function checkRecordCapacity(tier: PlanTier, activeRecords: number, adding: number): LimitCheck {
  const limits = PLAN_LIMITS[tier]
  if (limits.maxActiveRecords !== null && activeRecords + adding > limits.maxActiveRecords) {
    return {
      allowed: false,
      reason: `This would exceed your plan's limit of ${limits.maxActiveRecords.toLocaleString('en-GB')} active records.`,
    }
  }
  return { allowed: true }
}

/**
 * Whether this plan may generate an audit package (PRD §22.4). The reason is
 * written for the person who reads it — no tier codes, no plan identifiers.
 */
export function checkAuditPackageAllowed(tier: PlanTier): LimitCheck {
  if (!PLAN_LIMITS[tier].allowsAuditPackage) {
    return {
      allowed: false,
      reason:
        'Your plan does not include verifier packages. These bundle your records with the ' +
        'original documents they came from, ready to hand to an auditor. Upgrade to a plan that ' +
        'stores documents to use this.',
    }
  }
  return { allowed: true }
}

export function checkSupplierConnection(
  tier: PlanTier,
  currentConnections: number,
  alreadyConnected: boolean,
): LimitCheck {
  // Requests to an already-connected supplier never count against the cap —
  // a cap change must not strand an in-flight relationship.
  if (alreadyConnected) return { allowed: true }
  const limits = PLAN_LIMITS[tier]
  if (limits.maxSupplierConnections !== null && currentConnections >= limits.maxSupplierConnections) {
    return {
      allowed: false,
      reason: `Your plan supports up to ${limits.maxSupplierConnections} connected suppliers.`,
    }
  }
  return { allowed: true }
}
