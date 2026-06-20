import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { colours, typography, spacing } from '@/lib/design-system'
import { UploadZone } from '@/components/UploadZone'

export default async function UploadPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const session = await auth()
  if (!session?.user) redirect('/login')
  const entityId = (session.user as Record<string, unknown>).entityId as string
  const sp = await searchParams
  const initialType = sp.type ?? ''

  const entity = await prisma.entity.findUnique({
    where: { id: entityId },
    select: { uploadEmailToken: true },
  })
  const uploadEmail = entity?.uploadEmailToken ? `upload-${entity.uploadEmailToken}@arbor.io` : null
  return (
    <div>
      <div style={{ marginBottom: spacing[5] }}>
        <h1
          style={{
            fontSize: typography.sizes.lg,
            fontWeight: typography.weights.medium,
            color: colours.textPrimary,
            margin: 0,
            letterSpacing: typography.tracking.tight,
          }}
        >
          Upload document
        </h1>
        <p
          style={{
            fontSize: typography.sizes.sm,
            fontWeight: typography.weights.light,
            color: colours.textSecondary,
            margin: `${spacing[1]} 0 0`,
          }}
        >
          Upload a document to extract and certify its data. Fields below the confidence
          threshold will be flagged for your review before records are written.
        </p>
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
            <code style={{ color: colours.textSecondary }}>{uploadEmail}</code> — we&apos;ll read them and notify you when they&apos;re ready.
          </p>
        )}
      </div>
    </div>
  )
}
