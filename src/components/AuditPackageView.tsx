import { colours, typography, spacing } from '@/lib/design-system'
import type { AuditPackage } from '@/lib/audit-package/generator'

// read-only presentational view of an assembled audit package.
// Shared by the verifier detail page and the external-auditor page. No actions.
const TIER_COLOUR: Record<string, string> = { A: colours.green, B: colours.amber, C: colours.slate }
const TIER_LABEL: Record<string, string> = { A: 'Verified', B: 'Declared', C: 'Estimated' }

const th = {
  padding: '8px 12px',
  fontSize: typography.sizes.xs,
  fontWeight: typography.weights.medium,
  color: colours.textSecondary,
  letterSpacing: typography.tracking.wider,
  textTransform: 'uppercase' as const,
  textAlign: 'left' as const,
}
const td = {
  padding: '8px 12px',
  fontSize: typography.sizes.sm,
  fontWeight: typography.weights.light,
  color: colours.textPrimary,
}

export function AuditPackageView({
  pkg,
  chainIntegrityVerified,
  auditEntryCount,
}: {
  pkg: AuditPackage
  chainIntegrityVerified: boolean
  auditEntryCount: number
}) {
  const fmt = (d: Date) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: spacing[3] }}>
      {/* Verification banner */}
      {pkg.verification && (
        <div
          style={{
            backgroundColor: colours.greenBg,
            border: `1px solid ${colours.green}`,
            borderRadius: '6px',
            padding: spacing[2],
            fontSize: typography.sizes.sm,
            fontWeight: typography.weights.light,
            color: colours.green,
          }}
        >
          Independently verified by <strong style={{ fontWeight: typography.weights.medium }}>{pkg.verification.verifierName}</strong> on {new Date(pkg.verification.verifiedAt).toLocaleDateString('en-GB')}. Signature {pkg.verification.signatureHash.slice(0, 16)}…
        </div>
      )}

      {/* Summary */}
      <div style={{ backgroundColor: colours.surface, border: `1px solid ${colours.border}`, borderRadius: '6px', padding: spacing[3] }}>
        <div style={{ display: 'flex', gap: spacing[4], flexWrap: 'wrap' as const }}>
          <Stat label="Records" value={String(pkg.summary.totalRecords)} />
          <Stat label="Verified" value={String(pkg.summary.tierACount)} colour={colours.green} />
          <Stat label="Declared" value={String(pkg.summary.tierBCount)} colour={colours.amber} />
          <Stat label="Estimated" value={String(pkg.summary.tierCCount)} colour={colours.slate} />
          <Stat label="Source docs" value={String(pkg.summary.sourceDocumentCount)} />
          <Stat
            label="Audit chain"
            value={chainIntegrityVerified ? 'Intact' : 'Broken'}
            colour={chainIntegrityVerified ? colours.green : colours.red}
          />
          <Stat label="Chain entries" value={String(auditEntryCount)} />
        </div>
      </div>

      {/* Records */}
      <div style={{ backgroundColor: colours.surface, border: `1px solid ${colours.border}`, borderRadius: '6px', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${colours.border}`, backgroundColor: colours.background }}>
              <th style={th}>Field</th>
              <th style={th}>Domain</th>
              <th style={th}>Value</th>
              <th style={th}>Period</th>
              <th style={th}>Tier</th>
            </tr>
          </thead>
          <tbody>
            {pkg.dataRecords.map((r, i) => (
              <tr key={r.id} style={{ borderBottom: i < pkg.dataRecords.length - 1 ? `1px solid ${colours.border}` : 'none' }}>
                <td style={td}>{r.fieldName}</td>
                <td style={{ ...td, color: colours.textSecondary }}>{r.domain}</td>
                <td style={{ ...td, fontVariantNumeric: 'tabular-nums' as const }}>{r.value} {r.unit}</td>
                <td style={{ ...td, color: colours.textSecondary, whiteSpace: 'nowrap' as const }}>{fmt(r.periodStart)} – {fmt(r.periodEnd)}</td>
                <td style={{ ...td, color: TIER_COLOUR[r.trustTier], fontWeight: typography.weights.medium }}>{TIER_LABEL[r.trustTier]}</td>
              </tr>
            ))}
            {pkg.dataRecords.length === 0 && (
              <tr><td style={{ ...td, color: colours.textTertiary }} colSpan={5}>No records in this period.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Integrity hash */}
      <div style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textTertiary, wordBreak: 'break-all' as const }}>
        Package integrity hash: <span style={{ fontFamily: 'monospace' }}>{pkg.packageIntegrityHash}</span>
      </div>
    </div>
  )
}

function Stat({ label, value, colour }: { label: string; value: string; colour?: string }) {
  return (
    <div>
      <div
        style={{
          fontSize: typography.sizes.xs,
          fontWeight: typography.weights.medium,
          color: colours.textTertiary,
          letterSpacing: typography.tracking.wider,
          textTransform: 'uppercase' as const,
          marginBottom: '4px',
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: '22px', fontWeight: typography.weights.medium, color: colour ?? colours.textPrimary, lineHeight: 1 }}>
        {value}
      </div>
    </div>
  )
}
