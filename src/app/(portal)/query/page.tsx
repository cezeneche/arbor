import { spacing, textStyles } from '@/lib/design-system'
import { QueryEngine } from './QueryEngine'

export default function QueryPage() {
  return (
    <div>
      <div style={{ marginBottom: spacing[4] }}>
        <h1
          style={textStyles.pageTitle}
        >
          Query
        </h1>
        <p
          style={{ ...textStyles.sectionSubtitle, margin: `${spacing[1]} 0 0` }}
        >
          Ask a question in plain English. arbor answers from your own certified records and shows
          you every one it used, with its certification. It never works figures out for you.
        </p>
      </div>

      <QueryEngine />
    </div>
  )
}
