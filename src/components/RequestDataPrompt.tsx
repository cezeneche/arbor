import Link from 'next/link'
import { colours, spacing, textStyles } from '@/lib/design-system'
import { REQUEST_KINDS } from '@/lib/requests/request-kind'

// Asking which kind of data, rather than inferring it.
//
// The wrong guess sends a supplier a form they cannot answer — a records request
// to someone who has never seen an Arbor document, or a CBAM intensity form to
// someone asked for last quarter's electricity bills. Either way it goes
// unanswered and nobody finds out why.
//
// Each option states what the supplier is asked AND where the answer lands.
// Either half alone leaves the choice a guess.

export function RequestDataPrompt() {
  return (
    <div style={{ borderTop: `1px solid ${colours.border}`, paddingTop: spacing[3] }}>
      <div
        style={{
          ...textStyles.rowTitle,
          marginBottom: '4px',
        }}
      >
        Request data from a supplier
      </div>
      <p
        style={{
          ...textStyles.sectionSubtitle,
          margin: `0 0 ${spacing[3]}`,
        }}
      >
        What you are asking for changes what the supplier sees, so pick the one
        that matches.
      </p>

      <div style={{ display: 'grid', gap: spacing[2], maxWidth: '640px' }}>
        {REQUEST_KINDS.map(kind => (
          <Link key={kind.id} href={kind.href} style={{ textDecoration: 'none' }}>
            <div
              style={{
                border: `1px solid ${colours.border}`,
                borderRadius: '6px',
                padding: spacing[3],
                backgroundColor: colours.surface,
              }}
            >
              <div
                style={{
                  ...textStyles.sectionTitle,
                  marginBottom: '4px',
                }}
              >
                {kind.label}
              </div>
              <p
                style={{
                  ...textStyles.value,
                  margin: 0,
                }}
              >
                {kind.asks}
              </p>
              <p
                style={{
                  ...textStyles.caption,
                  margin: '6px 0 0',
                }}
              >
                {kind.produces}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
