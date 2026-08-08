import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/session'
import Link from 'next/link'
import { requirePageSession } from '@/lib/page-auth'
import { colours, typography, spacing } from '@/lib/design-system'

// verifier portal shell. Verifiers belong to no entity; this is a
// deliberately minimal chrome, separate from the entity portal Nav.
export default async function VerifierLayout({ children }: { children: React.ReactNode }) {
  const session = await requirePageSession()
  const role = getSessionUser(session).role
  if (role !== 'VERIFIER') redirect('/dashboard')

  return (
    <div style={{ minHeight: '100vh', backgroundColor: colours.background }}>
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: `${spacing[2]} ${spacing[5]}`,
          backgroundColor: colours.navy,
          color: colours.surface,
        }}
      >
        <Link
          href="/verifier/assignments"
          style={{
            fontSize: typography.sizes.base,
            fontWeight: typography.weights.medium,
            color: colours.surface,
            textDecoration: 'none',
            letterSpacing: typography.tracking.wide,
          }}
        >
          arbor · Verifier
        </Link>
        <span style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, opacity: 0.85 }}>
          {getSessionUser(session).email as string}
        </span>
      </header>
      <main style={{ maxWidth: '960px', margin: '0 auto', padding: `${spacing[5]} ${spacing[4]}` }}>
        {children}
      </main>
    </div>
  )
}
