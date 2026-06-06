import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { colours, typography, spacing } from '@/lib/design-system'
import { DOCUMENT_FIELD_DEFINITIONS } from '@/lib/extraction/field-definitions'

const DOMAIN_LABELS: Record<string, string> = {
  ENERGY: 'Energy', MATERIALS: 'Materials', PRODUCTION: 'Production',
  LOGISTICS: 'Logistics', EMISSIONS: 'Emissions', AGRICULTURE: 'Agriculture',
  WASTE_AND_WATER: 'Waste & Water', COMPLIANCE: 'Compliance',
}

// Canonical compulsory field names per domain — derived from field-definitions to stay in sync
const DOMAIN_COMPULSORY: Record<string, string[]> = {}
for (const [docType, defs] of Object.entries(DOCUMENT_FIELD_DEFINITIONS)) {
  const domain = docTypeToDomain(docType)
  if (!domain) continue
  if (!DOMAIN_COMPULSORY[domain]) DOMAIN_COMPULSORY[domain] = []
  for (const d of defs) {
    if (d.admissibility === 'compulsory' && !DOMAIN_COMPULSORY[domain].includes(d.name)) {
      DOMAIN_COMPULSORY[domain].push(d.name)
    }
  }
}

function docTypeToDomain(docType: string): string | null {
  const map: Record<string, string> = {
    ELECTRICITY_BILL: 'ENERGY', GAS_BILL: 'ENERGY', FUEL_RECEIPT: 'ENERGY',
    RENEWABLE_CERTIFICATE: 'ENERGY',
    PRODUCTION_LOG: 'PRODUCTION', BILL_OF_MATERIALS: 'PRODUCTION',
    PROCESS_DATA_SHEET: 'PRODUCTION',
    MATERIAL_INTAKE: 'MATERIALS',
    FREIGHT_INVOICE: 'LOGISTICS', DELIVERY_NOTE: 'LOGISTICS',
    BILL_OF_LADING: 'LOGISTICS',
    CUSTOMS_DECLARATION: 'COMPLIANCE', CBAM_DECLARATION: 'COMPLIANCE',
    ENVIRONMENTAL_CERTIFICATE: 'COMPLIANCE', PRODUCT_CERTIFICATE: 'COMPLIANCE',
    CHAIN_OF_CUSTODY: 'COMPLIANCE', SUPPLIER_QUESTIONNAIRE: 'COMPLIANCE',
    SUPPLIER_INVOICE: 'MATERIALS', PURCHASE_ORDER: 'MATERIALS',
    WASTE_RECORD: 'WASTE_AND_WATER', WATER_RECORD: 'WASTE_AND_WATER',
    CARBON_FOOTPRINT_REPORT: 'EMISSIONS', EMISSIONS_FACTOR_DOC: 'EMISSIONS',
    CROP_YIELD_RECORD: 'AGRICULTURE', FERTILISER_RECORD: 'AGRICULTURE',
    LIVESTOCK_RECORD: 'AGRICULTURE', LAND_USE_CERTIFICATE: 'AGRICULTURE',
  }
  return map[docType] ?? null
}

function quarterKey(date: Date): string {
  const q = Math.floor(date.getMonth() / 3) + 1
  return `Q${q} ${date.getFullYear()}`
}

export default async function AnalyticsPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')

  const entityId = (session.user as Record<string, unknown>).entityId as string
  const entity = await prisma.entity.findUnique({
    where: { id: entityId },
    select: { legalName: true, entityType: true },
  })
  const isSupplier = entity?.entityType !== 'BUYER'

  const records = await prisma.dataRecord.findMany({
    where: { entityId, isActive: true },
    select: {
      domain: true, fieldName: true, trustTier: true,
      periodStart: true, periodEnd: true,
    },
    orderBy: { periodStart: 'asc' },
  })

  // — Domain-level summary —
  const byDomain: Record<string, {
    totalRecords: number; tierA: number; tierB: number; tierC: number; fields: Set<string>
  }> = {}
  // — Quarter × Domain × Field presence —
  const quarterFieldMap: Record<string, Record<string, Set<string>>> = {}
  const quarterTierMap: Record<string, Record<string, { A: number; B: number; C: number }>> = {}

  for (const r of records) {
    const dom = r.domain
    if (!byDomain[dom]) byDomain[dom] = { totalRecords: 0, tierA: 0, tierB: 0, tierC: 0, fields: new Set() }
    byDomain[dom].totalRecords++
    byDomain[dom].fields.add(r.fieldName)
    if (r.trustTier === 'A') byDomain[dom].tierA++
    else if (r.trustTier === 'B') byDomain[dom].tierB++
    else byDomain[dom].tierC++

    const qk = quarterKey(new Date(r.periodStart))
    if (!quarterFieldMap[qk]) quarterFieldMap[qk] = {}
    if (!quarterFieldMap[qk][dom]) quarterFieldMap[qk][dom] = new Set()
    quarterFieldMap[qk][dom].add(r.fieldName)

    if (!quarterTierMap[qk]) quarterTierMap[qk] = {}
    if (!quarterTierMap[qk][dom]) quarterTierMap[qk][dom] = { A: 0, B: 0, C: 0 }
    quarterTierMap[qk][dom][r.trustTier as 'A' | 'B' | 'C']++
  }

  const allQuarters = Object.keys(quarterFieldMap).sort()
  const lastFourQuarters = allQuarters.slice(-4)
  const domainsWithData = Object.keys(byDomain)

  // — Buyer supply chain coverage —
  let supplierCoverage: Array<{
    supplierId: string; supplierName: string
    domains: Record<string, { count: number; tierA: number }>
    lastSubmission: string | null
  }> = []
  if (!isSupplier) {
    const grants = await prisma.dataAccessGrant.findMany({
      where: { granteeEntityId: entityId, isActive: true },
      select: { grantorEntityId: true, grantorEntity: { select: { legalName: true } } },
      distinct: ['grantorEntityId'],
    })
    supplierCoverage = await Promise.all(grants.map(async g => {
      const sr = await prisma.dataRecord.findMany({
        where: { entityId: g.grantorEntityId, isActive: true },
        select: { domain: true, trustTier: true, submittedAt: true },
        orderBy: { submittedAt: 'desc' },
      })
      const domains: Record<string, { count: number; tierA: number }> = {}
      for (const r of sr) {
        if (!domains[r.domain]) domains[r.domain] = { count: 0, tierA: 0 }
        domains[r.domain].count++
        if (r.trustTier === 'A') domains[r.domain].tierA++
      }
      return {
        supplierId: g.grantorEntityId,
        supplierName: g.grantorEntity.legalName,
        domains,
        lastSubmission: sr[0]?.submittedAt
          ? new Date(sr[0].submittedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
          : null,
      }
    }))
  }

  const sectionLabel = {
    fontSize: typography.sizes.xs,
    fontWeight: typography.weights.medium,
    color: colours.textSecondary,
    letterSpacing: typography.tracking.wider,
    textTransform: 'uppercase' as const,
    margin: `0 0 ${spacing[2]}`,
  }

  function tierPill(label: string, count: number, colour: string, bg: string) {
    if (count === 0) return null
    return (
      <span key={label} style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.medium, color: colour, backgroundColor: bg, borderRadius: '3px', padding: '2px 7px', marginRight: '4px' }}>
        {count} {label}
      </span>
    )
  }

  return (
    <div style={{ maxWidth: '900px' }}>
      <div style={{ marginBottom: spacing[5] }}>
        <h1 style={{ fontSize: typography.sizes.lg, fontWeight: typography.weights.medium, color: colours.textPrimary, margin: 0, letterSpacing: typography.tracking.tight }}>
          Analytics
        </h1>
        <p style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textSecondary, margin: `${spacing[1]} 0 0` }}>
          {isSupplier ? 'Data completeness and coverage for your records.' : 'Supply chain data coverage across your authorised suppliers.'}
        </p>
      </div>

      {/* ── Domain completeness ── */}
      <section style={{ marginBottom: spacing[5] }}>
        <p style={sectionLabel}>Completeness by data type</p>
        {domainsWithData.length === 0 ? (
          <div style={{ backgroundColor: colours.surface, border: `1px solid ${colours.border}`, borderRadius: '8px', padding: spacing[4], textAlign: 'center' }}>
            <p style={{ fontSize: typography.sizes.base, fontWeight: typography.weights.light, color: colours.textTertiary, margin: 0 }}>No records yet.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {domainsWithData.map(domain => {
              const d = byDomain[domain]
              const expected = DOMAIN_COMPULSORY[domain]?.length ?? 1
              const covered = Math.min(d.fields.size, expected)
              const pct = Math.round((covered / expected) * 100)
              const missing = (DOMAIN_COMPULSORY[domain] ?? []).filter(f => !d.fields.has(f))

              return (
                <div key={domain} style={{ backgroundColor: colours.surface, border: `1px solid ${colours.border}`, borderRadius: '6px', padding: spacing[2] }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                    <div>
                      <p style={{ fontSize: typography.sizes.base, fontWeight: typography.weights.medium, color: colours.textPrimary, margin: 0 }}>
                        {DOMAIN_LABELS[domain] ?? domain}
                      </p>
                      <p style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textTertiary, margin: '2px 0 0' }}>
                        {d.totalRecords} record{d.totalRecords !== 1 ? 's' : ''} · {d.fields.size} of {expected} expected fields
                      </p>
                    </div>
                    <p style={{ fontSize: typography.sizes.lg, fontWeight: typography.weights.medium, color: pct >= 75 ? colours.green : pct >= 40 ? colours.amber : colours.textTertiary, margin: 0, letterSpacing: typography.tracking.tight }}>
                      {pct}%
                    </p>
                  </div>

                  <div style={{ height: '4px', backgroundColor: colours.background, borderRadius: '2px', overflow: 'hidden', marginBottom: '10px' }}>
                    <div style={{ height: '100%', width: `${pct}%`, backgroundColor: pct >= 75 ? colours.green : pct >= 40 ? colours.amber : colours.textTertiary, borderRadius: '2px' }} />
                  </div>

                  <div style={{ marginBottom: missing.length > 0 ? '10px' : 0 }}>
                    {tierPill('Verified', d.tierA, colours.green, colours.greenBg)}
                    {tierPill('Declared', d.tierB, colours.amber, colours.amberBg)}
                    {tierPill('Estimated', d.tierC, colours.textTertiary, colours.background)}
                  </div>

                  {/* Missing compulsory fields */}
                  {missing.length > 0 && (
                    <div style={{ borderTop: `1px solid ${colours.border}`, paddingTop: '10px' }}>
                      <p style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.medium, color: colours.amber, margin: '0 0 6px', letterSpacing: typography.tracking.wider, textTransform: 'uppercase' }}>
                        Missing compulsory fields
                      </p>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                        {missing.map(f => (
                          <span key={f} style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.amber, backgroundColor: colours.amberBg, border: `1px solid ${colours.amber}22`, borderRadius: '3px', padding: '2px 7px' }}>
                            {f.replace(/_/g, ' ')}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* ── Period × Domain drill-down ── */}
      {lastFourQuarters.length > 0 && (
        <section style={{ marginBottom: spacing[5] }}>
          <p style={sectionLabel}>Field coverage by quarter</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {lastFourQuarters.map(qk => {
              const qDomains = quarterFieldMap[qk] ?? {}
              const qTiers = quarterTierMap[qk] ?? {}
              const activeDomains = Object.keys(qDomains)

              return (
                <div key={qk} style={{ backgroundColor: colours.surface, border: `1px solid ${colours.border}`, borderRadius: '6px', padding: spacing[2] }}>
                  <p style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.medium, color: colours.textPrimary, margin: `0 0 12px` }}>{qk}</p>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {activeDomains.map(domain => {
                      const presentFields = qDomains[domain]
                      const expected = DOMAIN_COMPULSORY[domain] ?? []
                      const missing = expected.filter(f => !presentFields.has(f))
                      const tiers = qTiers[domain] ?? { A: 0, B: 0, C: 0 }
                      const pct = expected.length > 0
                        ? Math.round(((expected.length - missing.length) / expected.length) * 100)
                        : 100

                      return (
                        <div key={domain}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px' }}>
                            <div>
                              <p style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textPrimary, margin: 0 }}>
                                {DOMAIN_LABELS[domain] ?? domain}
                              </p>
                              <div style={{ marginTop: '3px' }}>
                                {tierPill('Verified', tiers.A, colours.green, colours.greenBg)}
                                {tierPill('Declared', tiers.B, colours.amber, colours.amberBg)}
                              </div>
                            </div>
                            <span style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.medium, color: pct >= 75 ? colours.green : pct >= 40 ? colours.amber : colours.textTertiary }}>
                              {pct}%
                            </span>
                          </div>

                          {/* Field presence pills */}
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                            {expected.map(f => {
                              const present = presentFields.has(f)
                              return (
                                <span key={f} style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: present ? colours.green : colours.amber, backgroundColor: present ? colours.greenBg : colours.amberBg, border: `1px solid ${present ? colours.green : colours.amber}22`, borderRadius: '3px', padding: '2px 7px' }}>
                                  {present ? '✓' : '✗'} {f.replace(/_/g, ' ')}
                                </span>
                              )
                            })}
                          </div>

                          {/* Extra fields beyond compulsory */}
                          {(() => {
                            const extras = [...presentFields].filter(f => !expected.includes(f))
                            if (extras.length === 0) return null
                            return (
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '4px' }}>
                                {extras.map(f => (
                                  <span key={f} style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textSecondary, backgroundColor: colours.background, border: `1px solid ${colours.border}`, borderRadius: '3px', padding: '2px 7px' }}>
                                    + {f.replace(/_/g, ' ')}
                                  </span>
                                ))}
                              </div>
                            )
                          })()}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* ── Buyer: supply chain coverage ── */}
      {!isSupplier && (
        <section>
          <p style={sectionLabel}>Supply chain coverage</p>
          {supplierCoverage.length === 0 ? (
            <div style={{ backgroundColor: colours.surface, border: `1px solid ${colours.border}`, borderRadius: '8px', padding: spacing[4], textAlign: 'center' }}>
              <p style={{ fontSize: typography.sizes.base, fontWeight: typography.weights.light, color: colours.textTertiary, margin: 0 }}>
                No authorised suppliers yet. Send a data request to get started.
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {supplierCoverage.map(s => {
                const domainList = Object.keys(s.domains)
                const totalRecords = domainList.reduce((sum, d) => sum + s.domains[d].count, 0)
                const tierARecords = domainList.reduce((sum, d) => sum + s.domains[d].tierA, 0)
                const verifiedPct = totalRecords > 0 ? Math.round((tierARecords / totalRecords) * 100) : 0

                return (
                  <div key={s.supplierId} style={{ backgroundColor: colours.surface, border: `1px solid ${colours.border}`, borderRadius: '6px', padding: spacing[2] }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <p style={{ fontSize: typography.sizes.base, fontWeight: typography.weights.medium, color: colours.textPrimary, margin: 0 }}>{s.supplierName}</p>
                        <p style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textTertiary, margin: '4px 0 8px' }}>
                          {totalRecords} records · Last submitted {s.lastSubmission ?? 'never'}
                        </p>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                          {domainList.map(d => (
                            <span key={d} style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textSecondary, backgroundColor: colours.background, border: `1px solid ${colours.border}`, borderRadius: '3px', padding: '2px 7px' }}>
                              {DOMAIN_LABELS[d] ?? d}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <p style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.medium, color: colours.textTertiary, margin: '0 0 2px', letterSpacing: typography.tracking.wider, textTransform: 'uppercase' }}>Verified</p>
                        <p style={{ fontSize: typography.sizes.lg, fontWeight: typography.weights.medium, color: verifiedPct >= 75 ? colours.green : verifiedPct >= 40 ? colours.amber : colours.textTertiary, margin: 0, letterSpacing: typography.tracking.tight }}>
                          {verifiedPct}%
                        </p>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>
      )}
    </div>
  )
}
