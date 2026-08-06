import { PLAN_LIMITS, checkUploadAllowed, checkRecordCapacity, checkSupplierConnection, checkAuditPackageAllowed } from '@/lib/plan-limits'

describe('PLAN_LIMITS', () => {
  it('PILOT is uncapped everywhere (demo/pilot default — a demo can never hit a wall)', () => {
    const p = PLAN_LIMITS.PILOT
    expect(p.maxActiveRecords).toBeNull()
    expect(p.maxUploadsPerMonth).toBeNull()
    expect(p.maxSupplierConnections).toBeNull()
    expect(p.allowsUploads).toBe(true)
  })

  it('matches the pricing page: STARTER has no uploads and 5 declarations', () => {
    expect(PLAN_LIMITS.STARTER.allowsUploads).toBe(false)
    expect(PLAN_LIMITS.STARTER.maxActiveRecords).toBe(5)
  })

  it('matches the pricing page: MICRO 500 records / 10 uploads, SMALL 2500/50, GROWTH 10000/unlimited', () => {
    expect(PLAN_LIMITS.MICRO).toMatchObject({ maxActiveRecords: 500, maxUploadsPerMonth: 10 })
    expect(PLAN_LIMITS.SMALL).toMatchObject({ maxActiveRecords: 2500, maxUploadsPerMonth: 50 })
    expect(PLAN_LIMITS.GROWTH).toMatchObject({ maxActiveRecords: 10000, maxUploadsPerMonth: null })
  })

  it('matches the pricing page: buyer connections STANDARD 10, BUSINESS 50, ENTERPRISE unlimited', () => {
    expect(PLAN_LIMITS.STANDARD.maxSupplierConnections).toBe(10)
    expect(PLAN_LIMITS.BUSINESS.maxSupplierConnections).toBe(50)
    expect(PLAN_LIMITS.ENTERPRISE.maxSupplierConnections).toBeNull()
  })
})

describe('checkUploadAllowed', () => {
  it('PILOT always allows', () => {
    expect(checkUploadAllowed('PILOT', 9999).allowed).toBe(true)
  })
  it('STARTER never allows uploads', () => {
    const r = checkUploadAllowed('STARTER', 0)
    expect(r.allowed).toBe(false)
    expect(r.reason).toContain('plan')
  })
  it('MICRO allows under the monthly cap and blocks at it', () => {
    expect(checkUploadAllowed('MICRO', 9).allowed).toBe(true)
    expect(checkUploadAllowed('MICRO', 10).allowed).toBe(false)
  })
})

describe('checkRecordCapacity', () => {
  it('PILOT always allows', () => {
    expect(checkRecordCapacity('PILOT', 1_000_000, 500).allowed).toBe(true)
  })
  it('blocks when the batch would exceed the cap', () => {
    expect(checkRecordCapacity('MICRO', 499, 1).allowed).toBe(true)
    expect(checkRecordCapacity('MICRO', 499, 2).allowed).toBe(false)
    expect(checkRecordCapacity('MICRO', 500, 1).allowed).toBe(false)
  })
})

describe('checkSupplierConnection', () => {
  it('an existing connection is always allowed (never strands an in-flight relationship)', () => {
    expect(checkSupplierConnection('STANDARD', 10, true).allowed).toBe(true)
  })
  it('a new connection is blocked at the cap', () => {
    expect(checkSupplierConnection('STANDARD', 9, false).allowed).toBe(true)
    expect(checkSupplierConnection('STANDARD', 10, false).allowed).toBe(false)
  })
  it('ENTERPRISE and PILOT are unlimited', () => {
    expect(checkSupplierConnection('ENTERPRISE', 10_000, false).allowed).toBe(true)
    expect(checkSupplierConnection('PILOT', 10_000, false).allowed).toBe(true)
  })
})

// ── Audit package entitlement (PRD §22.4) ─────────────────────────────────────
// Audit package generation is a paid service, not a free button on every screen.
// Metered per-entity-per-period billing does not exist yet, so this is the
// entitlement seam rather than a real paywall — see checkAuditPackageAllowed.

describe('checkAuditPackageAllowed', () => {
  it('allows PILOT, which is uncapped while Arbor is at pilot stage', () => {
    expect(checkAuditPackageAllowed('PILOT').allowed).toBe(true)
  })

  it('refuses STARTER, which cannot hold source documents at all', () => {
    // A package whose whole value is document-backed provenance is meaningless
    // on a declaration-only tier.
    const got = checkAuditPackageAllowed('STARTER')
    expect(got.allowed).toBe(false)
    expect(got.reason).toMatch(/plan/i)
  })

  it('allows the document-carrying supplier tiers', () => {
    expect(checkAuditPackageAllowed('MICRO').allowed).toBe(true)
    expect(checkAuditPackageAllowed('SMALL').allowed).toBe(true)
    expect(checkAuditPackageAllowed('GROWTH').allowed).toBe(true)
  })

  it('allows every buyer tier', () => {
    expect(checkAuditPackageAllowed('STANDARD').allowed).toBe(true)
    expect(checkAuditPackageAllowed('BUSINESS').allowed).toBe(true)
    expect(checkAuditPackageAllowed('ENTERPRISE').allowed).toBe(true)
  })

  it('gives a reason a non-technical user can act on when it refuses', () => {
    const reason = checkAuditPackageAllowed('STARTER').reason ?? ''
    expect(reason.length).toBeGreaterThan(20)
    expect(reason).not.toMatch(/tier [ABC]|STARTER|null|undefined/)
  })
})
