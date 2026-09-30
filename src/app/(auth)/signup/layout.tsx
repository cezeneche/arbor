import type { Metadata } from 'next'
import { Suspense } from 'react'

export const metadata: Metadata = {
  title: 'Create your invited Arbor account',
  description: 'Complete signup with an Arbor pilot invitation.',
}

export default function SignupLayout({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<div aria-busy="true">Loading signup…</div>}>{children}</Suspense>
}
