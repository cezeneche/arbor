'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { signOut } from 'next-auth/react'
import { colours, typography, spacing } from '@/lib/design-system'

const links = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/upload', label: 'Upload' },
  { href: '/records', label: 'Records' },
  { href: '/requests', label: 'Requests' },
  { href: '/supply-chain', label: 'Supply chain' },
  { href: '/reports', label: 'Reports' },
  { href: '/benchmarks', label: 'Benchmarks' },
  { href: '/access', label: 'Access' },
  { href: '/settings/api-keys', label: 'Settings' },
]

export function Nav({ entityName }: { entityName: string }) {
  const pathname = usePathname()

  return (
    <nav
      style={{
        backgroundColor: colours.surface,
        borderBottom: `1px solid ${colours.border}`,
        padding: `0 ${spacing[4]}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        height: '56px',
        position: 'sticky',
        top: 0,
        zIndex: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: spacing[5] }}>
        <span
          style={{
            fontSize: typography.sizes.base,
            fontWeight: typography.weights.medium,
            color: colours.navy,
            letterSpacing: typography.tracking.tight,
          }}
        >
          Arbor
        </span>

        <div style={{ display: 'flex', gap: spacing[1] }}>
          {links.map(link => {
            const active = pathname === link.href || pathname.startsWith(link.href + '/')
            return (
              <Link
                key={link.href}
                href={link.href}
                style={{
                  padding: '6px 12px',
                  borderRadius: '4px',
                  fontSize: typography.sizes.sm,
                  fontWeight: active ? typography.weights.medium : typography.weights.light,
                  color: active ? colours.navy : colours.textSecondary,
                  backgroundColor: active ? colours.background : 'transparent',
                  textDecoration: 'none',
                  transition: 'background-color 0.1s',
                }}
              >
                {link.label}
              </Link>
            )
          })}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: spacing[2] }}>
        <span
          style={{
            fontSize: typography.sizes.sm,
            fontWeight: typography.weights.light,
            color: colours.textSecondary,
          }}
        >
          {entityName}
        </span>
        <button
          onClick={() => signOut({ callbackUrl: '/login' })}
          style={{
            padding: '6px 12px',
            fontSize: typography.sizes.sm,
            fontWeight: typography.weights.light,
            color: colours.textSecondary,
            backgroundColor: 'transparent',
            border: `1px solid ${colours.border}`,
            borderRadius: '4px',
            cursor: 'pointer',
          }}
        >
          Sign out
        </button>
      </div>
    </nav>
  )
}
