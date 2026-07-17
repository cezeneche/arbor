import Link from 'next/link'
import { getSessionUser } from '@/lib/session'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { colours, typography, spacing, textStyles } from '@/lib/design-system'
import { UploadZone } from '@/components/UploadZone'
import { uploadAddress } from '@/lib/email/config'

export default async function UploadPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const session = await auth()
  if (!session?.user) redirect('/login')
  const entityId = getSessionUser(session).entityId as string
  const sp = await searchParams
  const initialType = sp.type ?? ''

  const entity = await prisma.entity.findUnique({
    where: { id: entityId },
    select: { uploadEmailToken: true, entityType: true },
  })
  // Null until INBOUND_EMAIL_DOMAIN is configured — never show an address that bounces.
  const uploadEmail = uploadAddress(entity?.uploadEmailToken)
  const isBuyer = entity?.entityType === 'BUYER'
  return (
    <div style={{ width: '100%' }}>
      <div style={{ marginBottom: spacing[5] }}>
        <h1
          style={textStyles.pageTitle}
        >
          {isBuyer ? 'Ingest documents' : 'Upload document'}
        </h1>
        <p
          style={{ ...textStyles.sectionSubtitle, margin: `${spacing[1]} 0 0` }}
        >
          Upload a document to extract and certify its data. Fields below the confidence
          threshold will be flagged for your review before records are written.
        </p>

        {/* Provenance guard - an ingested document becomes the uploader's OWN
            record (confirm/route writes under the session entity). For buyers,
            steer supplier data to the request channel so it keeps the supplier's
            name and trust tier rather than being recorded as the buyer's own. */}
        {isBuyer && (
          <p
            style={{
              fontSize: typography.sizes.sm,
              fontWeight: typography.weights.light,
              color: colours.textSecondary,
              margin: `${spacing[2]} 0 0`,
              padding: spacing[2],
              backgroundColor: colours.surface,
              border: `1px solid ${colours.border}`,
              borderRadius: '6px',
            }}
          >
            Documents you ingest are recorded as your organisation&apos;s own data. To obtain a
            supplier&apos;s certified data - under their name and trust tier -{' '}
            <Link href="/supply-chain" style={{ color: colours.navy, textDecoration: 'none', fontWeight: typography.weights.medium }}>
              send a data request
            </Link>{' '}
            instead.
          </p>
        )}
      </div>

      <div
        style={{
          backgroundColor: colours.surface,
          border: `1px solid ${colours.border}`,
          borderRadius: '8px',
          padding: spacing[4],
        }}
      >
        <UploadZone initialType={initialType} />
      </div>

      <div
        style={{
          marginTop: spacing[3],
          padding: spacing[2],
          backgroundColor: colours.background,
          border: `1px solid ${colours.border}`,
          borderRadius: '6px',
        }}
      >
        <p
          style={{
            fontSize: typography.sizes.xs,
            fontWeight: typography.weights.light,
            color: colours.textTertiary,
            margin: 0,
          }}
        >
          Accepted formats: PDF, JPEG, PNG. Maximum file size: 20 MB.
          Documents are stored securely and only accessible to your organisation
          and buyers you have granted access.
        </p>
        {uploadEmail && (
          <p
            style={{
              fontSize: typography.sizes.xs,
              fontWeight: typography.weights.light,
              color: colours.textTertiary,
              margin: `${spacing[1]} 0 0`,
            }}
          >
            Or email documents as attachments to{' '}
            <code style={{ color: colours.textSecondary }}>{uploadEmail}</code> - we&apos;ll read them and notify you when they&apos;re ready.
          </p>
        )}
      </div>
    </div>
  )
}
