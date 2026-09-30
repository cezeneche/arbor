import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Institutional and research enquiries | Arbor',
  description: 'Explore possible institutional uses of evidence-labelled operational records and sector benchmark data with Arbor.',
}

export default function InstitutionalLayout({ children }: { children: React.ReactNode }) {
  return children
}
