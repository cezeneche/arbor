import { colours, typography, spacing } from '@/lib/design-system'
import { UploadZone } from '@/components/UploadZone'

export default function UploadPage() {
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
        <UploadZone />
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
      </div>
    </div>
  )
}
