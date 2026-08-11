import Link from 'next/link'
import { colours, spacing, textStyles } from '@/lib/design-system'
import { describeDocument, type ReusableDocument } from '@/lib/nucleos/reusable-documents'

// Two ways to start a case, because the document may already be here.
//
// Re-uploading a customs declaration Arbor already holds creates a second copy
// of one real-world document, each with its own extraction and audit trail.
// A certified repository should never hold two records of the same evidence.
//
// The upload half uses the same dashed box the Upload screen uses. A user who
// has uploaded once should recognise the target immediately rather than reading
// a link that happens to lead somewhere that looks different.

export function CbamStartCase({ documents }: { documents: ReusableDocument[] }) {
  return (
    <div style={{ marginBottom: spacing[5] }}>
      <p style={textStyles.rowTitle}>Start a case</p>
      <p style={{ ...textStyles.sectionSubtitle, margin: `4px 0 ${spacing[3]}` }}>
        From a customs declaration, supplier invoice or CBAM declaration.
      </p>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: documents.length > 0 ? '1fr 1fr' : '1fr',
          gap: spacing[3],
          alignItems: 'stretch',
          maxWidth: '720px',
        }}
      >
        {/* Same dashed target as the Upload screen. */}
        <Link href="/upload" style={{ textDecoration: 'none' }}>
          <div
            style={{
              border: `2px dashed ${colours.border}`,
              borderRadius: '8px',
              padding: spacing[4],
              textAlign: 'center',
              backgroundColor: colours.surface,
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: spacing[3],
            }}
          >
            <div>
              <p style={textStyles.sectionTitle}>Upload a document</p>
              <p style={{ ...textStyles.caption, margin: '4px 0 0' }}>
                PDF, JPEG or PNG
              </p>
            </div>
            <span
              style={{
                display: 'inline-block',
                padding: `${spacing[2]} ${spacing[4]}`,
                fontSize: textStyles.rowTitle.fontSize,
                fontWeight: textStyles.rowTitle.fontWeight,
                color: '#FFFFFF',
                backgroundColor: colours.navy,
                borderRadius: '4px',
              }}
            >
              Choose a file
            </span>
          </div>
        </Link>

        {documents.length > 0 && (
          <div
            style={{
              border: `1px solid ${colours.border}`,
              borderRadius: '8px',
              padding: spacing[3],
              backgroundColor: colours.surface,
            }}
          >
            <p style={textStyles.sectionTitle}>Use a document you already have</p>
            <p style={{ ...textStyles.caption, margin: `4px 0 ${spacing[3]}` }}>
              Already certified here — no second copy is made.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: spacing[2] }}>
              {documents.slice(0, 4).map(doc => (
                <Link
                  key={doc.id}
                  href={`/upload/${doc.id}/review`}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                    gap: spacing[3],
                    textDecoration: 'none',
                    paddingBottom: spacing[2],
                    borderBottom: `1px solid ${colours.border}`,
                  }}
                >
                  <span style={{ ...textStyles.value, minWidth: 0 }}>{describeDocument(doc)}</span>
                  <span
                    style={{
                      ...textStyles.caption,
                      color: colours.navy,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {doc.alreadyExtracted ? 'Review fields' : 'Read for CBAM'}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
