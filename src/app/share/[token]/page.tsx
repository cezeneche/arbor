import { prisma } from '@/lib/prisma'
import { isFrozenShare, shareRecordWhere } from '@/lib/shares/share-records'
import { fieldLabel } from '@/lib/layer3/field-label'
import { DOMAIN_LABELS } from '@/lib/domain-labels'
import { colours, typography, spacing, textStyles } from '@/lib/design-system'
import { TierBadge } from '@/components/TierBadge'
import { ShareVerifyButton } from '@/components/ShareVerifyButton'
import { isShareViewable } from '@/lib/shares/share-status'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { hashOpaqueToken } from '@/lib/tokens/opaque-token'

export const dynamic = 'force-dynamic'

function Unavailable() {
  return (
    <div style={{ minHeight: '100vh', backgroundColor: colours.background, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: spacing[4] }}>
      <div style={{ maxWidth: '420px', textAlign: 'center' }}>
        <div style={{ fontSize: typography.sizes.base, fontWeight: typography.weights.medium, color: colours.navy, letterSpacing: typography.tracking.tight, marginBottom: spacing[2] }}>
          arbor
        </div>
        <h1 style={{ fontSize: typography.sizes.lg, fontWeight: typography.weights.medium, color: colours.textPrimary, margin: 0 }}>
          This link is no longer available
        </h1>
        <p style={{ ...textStyles.sectionSubtitle, margin: `${spacing[2]} 0 0` }}>
          The shared data set has been revoked or has expired. Please ask the sender for a new link.
        </p>
      </div>
    </div>
  )
}

export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params

  const share = await prisma.sharedExport.findUnique({ where: { tokenHash: hashOpaqueToken(token) } })
  if (!share || !isShareViewable(share)) return <Unavailable />

  const entity = await prisma.entity.findUnique({
    where: { id: share.entityId },
    select: { legalName: true },
  })

  const frozen = isFrozenShare(share)
  const records = await prisma.dataRecord.findMany({
    where: shareRecordWhere(share),
    orderBy: [{ domain: 'asc' }, { periodStart: 'asc' }],
    select: {
      id: true, domain: true, fieldName: true, value: true, unit: true,
      trustTier: true, confidenceScore: true, periodStart: true, periodEnd: true,
      sourceText: true, isActive: true,
    },
  })
  const correctedSince = records.filter(r => !r.isActive).length

  // Log each open — one RecordAccessLog row per record disclosed (method EXPORT).
  // Throttled per token so a refresh loop can't amplify writes: at most one log
  // batch per window. Fails open (logs) if the limiter is unavailable.
  if (records.length > 0) {
    const { allowed } = await checkRateLimit(RATE_LIMITS.shareView, share.id)
    if (allowed) {
      await prisma.recordAccessLog.createMany({
        data: records.map((r) => ({
          recordId: r.id,
          granteeEntityId: `share:${share.id}`,
          accessMethod: 'EXPORT' as const,
        })),
      })
    }
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: colours.background, padding: spacing[6] }}>
      <div style={{ maxWidth: '960px', margin: '0 auto' }}>
        <div style={{ fontSize: typography.sizes.base, fontWeight: typography.weights.medium, color: colours.navy, letterSpacing: typography.tracking.tight, marginBottom: spacing[3] }}>
          arbor
        </div>

        <h1 style={textStyles.pageTitle}>
          {entity?.legalName ?? 'Shared data'}
        </h1>
        <p style={{ ...textStyles.sectionSubtitle, margin: `${spacing[1]} 0 ${spacing[3]}` }}>
          {records.length} certified record{records.length === 1 ? '' : 's'}
          {share.domain ? ` · ${DOMAIN_LABELS[share.domain] ?? share.domain}` : ''}
          {' · shared via Arbor. Every record carries its trust tier and provenance.'}
        </p>

        <div style={{ marginBottom: spacing[4], padding: spacing[3], backgroundColor: colours.surface, border: `1px solid ${colours.border}`, borderRadius: '8px' }}>
          <p style={{ margin: `0 0 ${spacing[2]}`, fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textSecondary }}>
            {frozen
              ? `These are the records as they stood when this share was issued on ${share.createdAt.toISOString().slice(0, 10)}, and the check below covers exactly them — no account needed.${correctedSince ? ` ${correctedSince} ${correctedSince === 1 ? 'has' : 'have'} been corrected since; the correction is on the audit chain, and the sender can issue a new share.` : ''}`
              : 'Every record here is part of a cryptographic audit chain. You can check that the chain is intact and that Arbor issued this share — no account needed. This share predates snapshots, so it shows the current records.'}
          </p>
          <ShareVerifyButton entityId={share.entityId} packageHash={share.packageHash} />
        </div>

        {records.length === 0 ? (
          <div style={{ padding: spacing[6], textAlign: 'center', backgroundColor: colours.surface, border: `1px solid ${colours.border}`, borderRadius: '8px' }}>
            <p style={{ margin: 0, fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textTertiary }}>
              No records fall within this shared scope.
            </p>
          </div>
        ) : (
          <div style={{ backgroundColor: colours.surface, border: `1px solid ${colours.border}`, borderRadius: '8px', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${colours.border}`, backgroundColor: colours.background }}>
                  {['Field', 'Value', 'Period', 'Domain', 'Trust tier', 'Confidence'].map((c) => (
                    <th key={c} style={{ padding: '10px 16px', fontSize: typography.sizes.xs, fontWeight: typography.weights.medium, color: colours.textSecondary, letterSpacing: typography.tracking.wider, textTransform: 'uppercase', textAlign: 'left' }}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {records.map((r, i) => (
                  <tr key={r.id} style={{ borderBottom: i < records.length - 1 ? `1px solid ${colours.border}` : 'none' }}>
                    <td style={{ padding: '12px 16px', fontSize: typography.sizes.sm, fontWeight: typography.weights.medium, color: colours.textPrimary }}>
                      {fieldLabel(r.fieldName)}
                      {!r.isActive && (
                        <div style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.amber, marginTop: '2px' }}>
                          Corrected since this share was issued
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textPrimary, fontVariantNumeric: 'tabular-nums' }}>
                      {r.value.toLocaleString('en-GB', { maximumFractionDigits: 4 })} {r.unit}
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textSecondary, whiteSpace: 'nowrap' }}>
                      {new Date(r.periodStart).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}
                      {' – '}
                      {new Date(r.periodEnd).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textSecondary }}>
                      {DOMAIN_LABELS[r.domain] ?? r.domain}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <TierBadge tier={r.trustTier} />
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textSecondary, fontVariantNumeric: 'tabular-nums' }}>
                      {(r.confidenceScore * 100).toFixed(0)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
