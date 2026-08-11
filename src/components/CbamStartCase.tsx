import Link from 'next/link'
import { colours, typography, spacing } from '@/lib/design-system'
import { describeDocument, type ReusableDocument } from '@/lib/nucleos/reusable-documents'

// Two ways to start a case, because the document may already be here.
//
// Re-uploading a customs declaration Arbor already holds creates a second copy
// of one real-world document, each with its own extraction and audit trail.
// A certified repository should never hold two records of the same evidence.

export function CbamStartCase({ documents }: { documents: ReusableDocument[] }) {
  const card = {
    border: `1px solid ${colours.border}`,
    borderRadius: '6px',
    padding: spacing[3],
    backgroundColor: colours.surface,
  }

  return (
    <div style={{ marginBottom: spacing[5] }}>
      <div
        style={{
          fontSize: typography.sizes.sm,
          fontWeight: typography.weights.medium,
          color: colours.textPrimary,
          marginBottom: '4px',
        }}
      >
        Start a case
      </div>
      <p
        style={{
          fontSize: typography.sizes.sm,
          fontWeight: typography.weights.light,
          color: colours.textSecondary,
          margin: `0 0 ${spacing[3]}`,
        }}
      >
        From a customs declaration, supplier invoice or CBAM declaration.
      </p>

      <div style={{ display: 'grid', gap: spacing[2], maxWidth: '640px' }}>
        <Link href="/upload" style={{ textDecoration: 'none' }}>
          <div style={card}>
            <div
              style={{
                fontSize: typography.sizes.base,
                fontWeight: typography.weights.medium,
                color: colours.textPrimary,
              }}
            >
              Upload a document
            </div>
            <p
              style={{
                fontSize: typography.sizes.sm,
                fontWeight: typography.weights.light,
                color: colours.textSecondary,
                margin: '4px 0 0',
              }}
            >
              Add a new document to Arbor and read it for CBAM at the same time.
            </p>
          </div>
        </Link>

        <div style={card}>
          <div
            style={{
              fontSize: typography.sizes.base,
              fontWeight: typography.weights.medium,
              color: colours.textPrimary,
            }}
          >
            Use a document you already have
          </div>

          {documents.length === 0 ? (
            <p
              style={{
                fontSize: typography.sizes.sm,
                fontWeight: typography.weights.light,
                color: colours.textSecondary,
                margin: '4px 0 0',
              }}
            >
              Nothing eligible yet. Customs declarations, supplier invoices and CBAM
              declarations appear here once they have been read.
            </p>
          ) : (
            <>
              <p
                style={{
                  fontSize: typography.sizes.sm,
                  fontWeight: typography.weights.light,
                  color: colours.textSecondary,
                  margin: '4px 0 10px',
                }}
              >
                These are already in Arbor with their provenance intact.
              </p>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {documents.map(doc => (
                  <li
                    key={doc.id}
                    style={{
                      display: 'flex',
                      alignItems: 'baseline',
                      justifyContent: 'space-between',
                      gap: spacing[2],
                      padding: '6px 0',
                      borderTop: `1px solid ${colours.border}`,
                    }}
                  >
                    <span
                      style={{
                        fontSize: typography.sizes.sm,
                        fontWeight: typography.weights.light,
                        color: colours.textPrimary,
                      }}
                    >
                      {describeDocument(doc)}
                    </span>
                    <Link
                      href={`/upload/${doc.id}/review`}
                      style={{
                        fontSize: typography.sizes.sm,
                        fontWeight: typography.weights.medium,
                        color: colours.navy,
                        textDecoration: 'none',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {doc.alreadyExtracted ? 'Review fields →' : 'Read for CBAM →'}
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
