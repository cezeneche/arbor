import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/session'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import Link from 'next/link'
import { colours, typography, spacing, textStyles } from '@/lib/design-system'
import { requestsAddress } from '@/lib/email/config'

interface ParsedShape {
  parsed?: { domain?: string | null; fields?: string[]; periodStart?: string | null; periodEnd?: string | null }
  missingFields?: string[]
  reason?: string
  // Set when we matched the request to certified records and are holding it for the
  // supplier to review and send — we never disclose data to the sender automatically.
  awaiting?: string
  answers?: { fieldName: string }[]
}

export default async function InboundRequestsPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')
  const entityId = getSessionUser(session).entityId as string

  const [entity, pending] = await Promise.all([
    prisma.entity.findUnique({ where: { id: entityId }, select: { uploadEmailToken: true } }),
    prisma.inboundRequest.findMany({ where: { entityId, status: 'NEEDS_DATA' }, orderBy: { createdAt: 'desc' } }),
  ])

  // "Ready to send" = we hold the data and are waiting on the supplier to approve
  // sharing it. Everything else in the queue is genuinely missing / unparseable.
  const readyToSend = pending.filter((r) => (r.parsedFields as ParsedShape | null)?.awaiting === 'supplier_review')
  const missing = pending.filter((r) => (r.parsedFields as ParsedShape | null)?.awaiting !== 'supplier_review')

  // Null until INBOUND_EMAIL_DOMAIN is configured — never show an address that bounces.
  const requestsEmail = requestsAddress(entity?.uploadEmailToken)

  return (
    <div style={{ width: '100%' }}>
      <div style={{ marginBottom: spacing[3] }}>
        <Link href="/requests" style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textSecondary, textDecoration: 'none' }}>
          ← Requests
        </Link>
      </div>
      <h1 style={textStyles.pageTitle}>
        Email requests
      </h1>
      <p style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textSecondary, margin: `${spacing[1]} 0 ${spacing[4]}`, maxWidth: '640px' }}>
        When a customer emails a data request to your Arbor address, we read it and match it to your certified
        records. Nothing is shared automatically — you review each request here and reply from your records.
      </p>

      {/* Action counts */}
      <div style={{ display: 'flex', gap: spacing[2], marginBottom: spacing[4] }}>
        <div style={{ flex: 1, padding: spacing[3], backgroundColor: readyToSend.length > 0 ? colours.greenBg : colours.surface, border: `1px solid ${readyToSend.length > 0 ? colours.green : colours.border}`, borderRadius: '8px' }}>
          <div style={{ fontSize: typography.sizes.hero, fontWeight: typography.weights.light, color: readyToSend.length > 0 ? colours.green : colours.textTertiary, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
            {readyToSend.length}
          </div>
          <div style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textSecondary, marginTop: '6px' }}>
            ready to review and send from your records
          </div>
        </div>
        <div style={{ flex: 1, padding: spacing[3], backgroundColor: missing.length > 0 ? colours.amberBg : colours.surface, border: `1px solid ${missing.length > 0 ? colours.amber : colours.border}`, borderRadius: '8px' }}>
          <div style={{ fontSize: typography.sizes.hero, fontWeight: typography.weights.light, color: missing.length > 0 ? colours.amber : colours.textTertiary, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
            {missing.length}
          </div>
          <div style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textSecondary, marginTop: '6px' }}>
            need{missing.length === 1 ? 's' : ''} data you haven&apos;t uploaded yet
          </div>
        </div>
      </div>

      {requestsEmail ? (
        <div style={{ marginBottom: spacing[4], padding: spacing[2], backgroundColor: colours.surface, border: `1px solid ${colours.border}`, borderRadius: '8px' }}>
          <p style={{ margin: 0, fontSize: typography.sizes.xs, fontWeight: typography.weights.medium, color: colours.textTertiary, letterSpacing: typography.tracking.wide, textTransform: 'uppercase' }}>
            Your requests address
          </p>
          <p style={{ margin: '6px 0 0', fontSize: typography.sizes.base, fontWeight: typography.weights.light, color: colours.textPrimary, fontFamily: 'monospace' }}>
            {requestsEmail}
          </p>
          <p style={{ margin: '6px 0 0', fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textTertiary }}>
            Give this to customers, or forward their requests here.
          </p>
        </div>
      ) : (
        <div style={{ marginBottom: spacing[4], padding: spacing[2], backgroundColor: colours.surface, border: `1px solid ${colours.border}`, borderRadius: '8px' }}>
          <p style={{ margin: 0, fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textTertiary }}>
            Email request intake isn&apos;t enabled on this workspace yet. You&apos;ll get a
            dedicated address here once it is — in the meantime, customers can send
            structured requests through the platform.
          </p>
        </div>
      )}

      {/* Ready to send — matched to certified records, awaiting supplier approval */}
      {readyToSend.length > 0 && (
        <div style={{ marginBottom: spacing[4] }}>
          <h2 style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.medium, color: colours.textTertiary, letterSpacing: typography.tracking.wider, textTransform: 'uppercase', margin: `0 0 ${spacing[1]}` }}>
            Ready to review and send
          </h2>
          <div style={{ backgroundColor: colours.surface, border: `1px solid ${colours.border}`, borderRadius: '8px', overflow: 'hidden' }}>
            {readyToSend.map((r, i) => {
              const pf = (r.parsedFields ?? {}) as ParsedShape
              const fieldCount = pf.answers?.length ?? 0
              return (
                <div key={r.id} style={{ padding: `${spacing[2]} ${spacing[3]}`, borderBottom: i < readyToSend.length - 1 ? `1px solid ${colours.border}` : 'none', backgroundColor: colours.greenBg }}>
                  <div style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.medium, color: colours.textPrimary }}>
                    {r.fromEmail ?? 'A customer'} asked for data {pf.parsed?.domain ? `(${pf.parsed.domain.replace(/_/g, ' ').toLowerCase()})` : ''}
                  </div>
                  <div style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textSecondary, marginTop: '4px' }}>
                    We matched {fieldCount > 0 ? `${fieldCount} field${fieldCount === 1 ? '' : 's'}` : 'this'} to your certified records. Review the request and reply to share it — nothing is sent until you do.
                  </div>
                  <div style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textTertiary, marginTop: '6px' }}>
                    {new Date(r.createdAt).toLocaleDateString('en-GB')}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Needs data */}
      {missing.length > 0 && (
        <div style={{ marginBottom: spacing[4] }}>
          <h2 style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.medium, color: colours.textTertiary, letterSpacing: typography.tracking.wider, textTransform: 'uppercase', margin: `0 0 ${spacing[1]}` }}>
            Needs your attention
          </h2>
          <div style={{ backgroundColor: colours.surface, border: `1px solid ${colours.border}`, borderRadius: '8px', overflow: 'hidden' }}>
            {missing.map((r, i) => {
              const pf = (r.parsedFields ?? {}) as ParsedShape
              const missingFields = pf.missingFields ?? []
              return (
                <div key={r.id} style={{ padding: `${spacing[2]} ${spacing[3]}`, borderBottom: i < missing.length - 1 ? `1px solid ${colours.border}` : 'none', backgroundColor: colours.amberBg }}>
                  <div style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.medium, color: colours.textPrimary }}>
                    {r.fromEmail ?? 'A customer'} asked for data {pf.parsed?.domain ? `(${pf.parsed.domain.replace(/_/g, ' ').toLowerCase()})` : ''}
                  </div>
                  <div style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textSecondary, marginTop: '4px' }}>
                    {missingFields.length > 0
                      ? `Missing: ${missingFields.map((m) => m.replace(/_/g, ' ')).join(', ')}. Upload a document covering this to answer it.`
                      : pf.reason === 'could_not_parse'
                        ? "We couldn't tell exactly what was being asked - open the email and respond manually."
                        : 'Some requested data is not in your records yet.'}
                  </div>
                  <div style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textTertiary, marginTop: '6px' }}>
                    {new Date(r.createdAt).toLocaleDateString('en-GB')}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {readyToSend.length === 0 && missing.length === 0 && (
        <div style={{ padding: spacing[6], textAlign: 'center', backgroundColor: colours.surface, border: `1px solid ${colours.border}`, borderRadius: '8px' }}>
          <p style={{ margin: 0, fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textTertiary }}>
            No email requests yet. When one arrives, we&apos;ll match it to your records and show it here for you to review.
          </p>
        </div>
      )}
    </div>
  )
}
