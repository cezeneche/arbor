import { redirect } from 'next/navigation'
import Link from 'next/link'
import { auth } from '@/lib/auth'
import { colours, typography, spacing } from '@/lib/design-system'

// Gap 4 — external-auditor shell. Read-only; scoped per AuditorAccess grant.
export default async function AuditorLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session?.user) redirect('/login')
  const role = (session.user as Record<string, unknown>).role as string | undefined
  if (role !== 'AUDITOR') redirect('/dashboard')

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
          href="/auditor"
          style={{
            fontSize: typography.sizes.base,
            fontWeight: typography.weights.medium,
            color: colours.surface,
            textDecoration: 'none',
            letterSpacing: typography.tracking.wide,
          }}
        >
          arbor · Auditor
        </Link>
        <span style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, opacity: 0.85 }}>
          {(session.user as Record<string, unknown>).email as string}
        </span>
      </header>
      <main style={{ maxWidth: '960px', margin: '0 auto', padding: `${spacing[5]} ${spacing[4]}` }}>
        {children}
      </main>
    </div>
  )
}
