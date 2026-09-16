import Link from 'next/link'
import { requirePageSession } from '@/lib/page-auth'
import { getSessionUser } from '@/lib/session'
import { colours, typography, spacing, textStyles } from '@/lib/design-system'
import { getCbamAuditLog, getCbamCase, type CbamCaseSummary } from '@/lib/nucleos/cases-client'
import { presentCase } from '@/lib/nucleos/case-presenter'
import { presentGoodsLines } from '@/lib/nucleos/goods-line-presenter'
import { presentGaps } from '@/lib/nucleos/gap-vocabulary'
import { calculateCase, caseContext } from '@/lib/nucleos/case-calculation'
import {
  availableReturns,
  describeJurisdiction,
  resolveJurisdiction,
} from '@/lib/nucleos/jurisdiction'
import type { CaseGoodsLine } from '@/lib/nucleos/declaration-payload'
import { CbamEmissions } from '@/components/CbamEmissions'
import { CbamReturnBuilder } from '@/components/CbamReturnBuilder'

// One case, end to end.
//
// It used to show six fields — importer, period, sector, status, origin, mass —
// and stop. No goods lines, no emissions method, no reason a better figure was
// not used, no decision trace, no mark-up, and no way to produce the return the
// whole case exists to produce. Everything the engine computed was reachable
// over the boundary and none of it was rendered.
//
// Sections stacked, not tabs: the design rules forbid tabs, and the order here
// is the order the work happens in — what came in, what it declares, what is
// still missing, what to file, and what has happened to the case.

export default async function CbamCasePage({
  params,
}: {
  params: Promise<{ caseId: string }>
}) {
  const session = await requirePageSession()
  const entityId = getSessionUser(session).entityId as string
  const { caseId } = await params

  // Ownership is decided before anything is read, not per section.
  //
  // Every read below goes through one shared service token, so Nucleos cannot
  // scope them by entity — this check is the only thing that can. Applying it
  // to the emissions block alone still rendered another organisation's goods,
  // gaps, audit trail and return button.
  const { forbidden } = await caseContext(caseId, entityId)
  if (forbidden) {
    return (
      <div>
        <Link
          href="/cbam?view=cases"
          style={{
            fontSize: typography.sizes.sm,
            fontWeight: typography.weights.light,
            color: colours.textSecondary,
            textDecoration: 'none',
          }}
        >
          ← CBAM
        </Link>
        <h1 style={{ ...textStyles.pageTitle, marginTop: spacing[2] }}>CBAM case</h1>
        <p style={{ ...textStyles.sectionSubtitle, marginTop: spacing[2] }}>
          This case belongs to another organisation.
        </p>
      </div>
    )
  }

  let record: Record<string, unknown> | null = null
  let error: string | null = null
  try {
    record = await getCbamCase(caseId)
  } catch (err) {
    error = (err as Error).message
  }

  const row = record ? presentCase(record as unknown as CbamCaseSummary) : null
  const goodsLines = record ? presentGoodsLines(record.goods_lines as CaseGoodsLine[]) : []
  const gaps = presentGaps(record?.open_gaps)
  const jurisdiction = resolveJurisdiction(record?.jurisdiction)

  // Both reads are independent of the case load and of each other. A failing
  // audit log must not take the emissions down with it, so each carries its own
  // failure rather than one try block covering all three.
  const calculation = record ? await calculateCase(caseId, entityId) : null
  const audit = record
    ? await getCbamAuditLog(caseId).catch(err => ({ error: (err as Error).message }) as const)
    : null

  const label = {
    fontSize: typography.sizes.xs,
    fontWeight: typography.weights.medium,
    color: colours.textTertiary,
    letterSpacing: typography.tracking.wider,
    textTransform: 'uppercase' as const,
    margin: '0 0 4px',
  }
  const value = {
    fontSize: typography.sizes.base,
    fontWeight: typography.weights.light,
    color: colours.textPrimary,
    margin: 0,
  }
  const section = {
    border: `1px solid ${colours.border}`,
    borderRadius: '8px',
    padding: spacing[3],
    backgroundColor: colours.surface,
  }
  const cell = {
    padding: `${spacing[1]} ${spacing[2]} ${spacing[1]} 0`,
    fontSize: typography.sizes.sm,
    fontWeight: typography.weights.light,
    color: colours.textPrimary,
    borderBottom: `1px solid ${colours.border}`,
    textAlign: 'left' as const,
    verticalAlign: 'top' as const,
  }
  const headCell = {
    ...cell,
    ...textStyles.eyebrow,
    color: colours.textTertiary,
    paddingBottom: spacing[1],
  }

  return (
    <div>
      <Link
        href="/cbam?view=cases"
        style={{
          fontSize: typography.sizes.sm,
          fontWeight: typography.weights.light,
          color: colours.textSecondary,
          textDecoration: 'none',
        }}
      >
        ← CBAM
      </Link>

      <h1 style={{ ...textStyles.pageTitle, marginTop: spacing[2] }}>
        {row?.importer ?? 'CBAM case'}
      </h1>

      {error ? (
        <p
          style={{
            fontSize: typography.sizes.sm,
            fontWeight: typography.weights.light,
            color: colours.amber,
            marginTop: spacing[3],
          }}
        >
          This case could not be loaded, so nothing below is showing its real state.
          <span style={{ display: 'block', color: colours.textTertiary, marginTop: '4px' }}>
            {error}
          </span>
        </p>
      ) : row ? (
        <>
          <p style={{ ...textStyles.sectionSubtitle, margin: `${spacing[1]} 0 ${spacing[4]}` }}>
            {row.period} · {row.sector} · {row.status} · {describeJurisdiction(jurisdiction).label}
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: spacing[3] }}>
            <div
              style={{
                ...section,
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                gap: spacing[3],
              }}
            >
              <div>
                <p style={label}>Origin</p>
                <p style={value}>{row.origin}</p>
              </div>
              <div>
                <p style={label}>Net mass</p>
                <p style={value}>{row.mass}</p>
              </div>
              <div>
                <p style={label}>Exposure</p>
                <p style={value}>{row.exposure}</p>
                {row.exposureNote && (
                  <p
                    style={{
                      fontSize: typography.sizes.xs,
                      fontWeight: typography.weights.light,
                      color: colours.amber,
                      margin: '4px 0 0',
                    }}
                  >
                    {row.exposureNote}
                  </p>
                )}
              </div>
            </div>

            {/* What came in. */}
            <div style={section}>
              <p style={{ ...textStyles.sectionTitle, marginBottom: spacing[2] }}>
                Goods on this case
              </p>
              {goodsLines.length === 0 ? (
                <p style={textStyles.sectionSubtitle}>
                  No goods lines yet. Confirm a customs declaration to add them.
                </p>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th style={headCell}>#</th>
                        <th style={headCell}>Code</th>
                        <th style={headCell}>Goods</th>
                        <th style={headCell}>Weight</th>
                        <th style={headCell}>Origin</th>
                        <th style={headCell}>Installation</th>
                        <th style={headCell}>Declared emissions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {goodsLines.map(line => (
                        <tr key={line.id}>
                          <td style={{ ...cell, color: colours.textTertiary }}>{line.position}</td>
                          <td style={cell}>
                            {line.cnCode}
                            {line.cnCodeIncomplete && (
                              <span
                                style={{
                                  display: 'block',
                                  ...textStyles.caption,
                                  color: colours.amber,
                                }}
                              >
                                Not a full 8-digit code — CBAM needs one to identify the goods.
                              </span>
                            )}
                          </td>
                          <td style={cell}>{line.description}</td>
                          <td style={cell}>{line.mass}</td>
                          <td style={cell}>{line.origin}</td>
                          <td style={cell}>{line.installation}</td>
                          <td style={cell}>
                            {line.declaredEmissions}
                            {line.emissionsNeeded && (
                              <span
                                style={{
                                  display: 'block',
                                  ...textStyles.caption,
                                  color: colours.textTertiary,
                                }}
                              >
                                {line.emissionsNeeded}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* What it declares. */}
            <div style={section}>
              <p style={{ ...textStyles.sectionTitle, marginBottom: spacing[1] }}>Emissions</p>
              <p style={{ ...textStyles.sectionSubtitle, marginBottom: spacing[3] }}>
                How each figure was arrived at, and how well evidenced the record behind it is.
                They are separate questions.
              </p>
              {calculation?.loadError ? (
                <p style={{ ...textStyles.sectionSubtitle, color: colours.amber }}>
                  The emissions could not be worked out: {calculation.loadError}
                </p>
              ) : (
                <CbamEmissions results={calculation?.results ?? []} />
              )}
            </div>

            {/* What is still missing. */}
            {(gaps.blocking.length > 0 || gaps.advisory.length > 0) && (
              <div style={section}>
                <p style={{ ...textStyles.sectionTitle, marginBottom: spacing[1] }}>
                  What is still missing
                </p>
                {gaps.summary && (
                  <p
                    style={{
                      ...textStyles.sectionSubtitle,
                      color: gaps.blocksReturn ? colours.amber : colours.textSecondary,
                      marginBottom: spacing[2],
                    }}
                  >
                    {gaps.summary}
                  </p>
                )}
                <ul
                  style={{
                    margin: 0,
                    paddingLeft: '18px',
                    fontSize: typography.sizes.sm,
                    fontWeight: typography.weights.light,
                    color: colours.textPrimary,
                    lineHeight: '1.7',
                  }}
                >
                  {[...gaps.blocking, ...gaps.advisory].map(gap => (
                    <li key={gap.raw}>
                      {gap.where} is missing {gap.what}.{' '}
                      <span style={{ ...textStyles.caption, color: colours.textTertiary }}>
                        {gap.raw}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* What to file. */}
            <div style={section}>
              <p style={{ ...textStyles.sectionTitle, marginBottom: spacing[1] }}>Your return</p>
              <p style={{ ...textStyles.sectionSubtitle, marginBottom: spacing[3] }}>
                {describeJurisdiction(jurisdiction).detail}
              </p>
              <CbamReturnBuilder
                caseId={caseId}
                available={[...availableReturns(jurisdiction)]}
                blocked={
                  gaps.blocksReturn
                    ? 'Some required information is still missing from this case, so a return ' +
                      'cannot be produced yet. The list above says what.'
                    : null
                }
              />
            </div>

            {/* What has happened to it. */}
            <div style={section}>
              <p style={{ ...textStyles.sectionTitle, marginBottom: spacing[1] }}>Audit trail</p>
              {audit && 'error' in audit ? (
                <p style={{ ...textStyles.sectionSubtitle, color: colours.amber }}>
                  The history for this case could not be loaded: {audit.error}
                </p>
              ) : audit ? (
                <>
                  <p
                    style={{
                      ...textStyles.sectionSubtitle,
                      color: audit.chain_valid ? colours.green : colours.red,
                      marginBottom: spacing[2],
                    }}
                  >
                    {audit.chain_valid
                      ? `${audit.count} event${audit.count === 1 ? '' : 's'}, chain intact.`
                      : 'The chain of events for this case does not verify. Do not file from it ' +
                        'until this is resolved.'}
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: spacing[1] }}>
                    {audit.events.map((event, i) => (
                      <div
                        key={event.id ?? i}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          gap: spacing[2],
                          paddingBottom: spacing[1],
                          borderBottom: `1px solid ${colours.border}`,
                        }}
                      >
                        <span style={textStyles.value}>
                          {(event.event_type ?? 'event').replace(/_/g, ' ')}
                          {!event.verified && (
                            <span style={{ color: colours.red }}> · signature does not verify</span>
                          )}
                        </span>
                        <span
                          style={{
                            ...textStyles.caption,
                            color: colours.textTertiary,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {event.created_at
                            ? new Date(event.created_at).toLocaleString('en-GB')
                            : '—'}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </>
      ) : null}
    </div>
  )
}
