'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { signOut } from 'next-auth/react'
import { colours, typography, spacing } from '@/lib/design-system'
import { getNavLinks, isLinkActive } from '@/lib/nav'

export function Nav({
  entityName,
  entityType = 'SUPPLIER',
  recordCount,
}: {
  entityName: string
  entityType?: 'SUPPLIER' | 'BUYER'
  recordCount?: number
}) {
  const pathname = usePathname()
  const links = getNavLinks(entityType)

  return (
    <nav
      style={{
        width: '216px',
        height: '100vh',
        backgroundColor: colours.navy,
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        overflowY: 'auto',
      }}
    >
      {/* Wordmark + entity */}
      <div style={{ padding: `${spacing[3]} ${spacing[2]} ${spacing[2]}` }}>
        <div
          style={{
            fontSize: typography.sizes.base,
            fontWeight: typography.weights.medium,
            color: '#FFFFFF',
            letterSpacing: typography.tracking.tight,
            marginBottom: '6px',
          }}
        >
          arbor
        </div>
        <div
          style={{
            fontSize: typography.sizes.xs,
            fontWeight: typography.weights.light,
            color: 'rgba(255,255,255,0.45)',
            letterSpacing: typography.tracking.wide,
            textTransform: 'uppercase',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {entityName}
        </div>
      </div>

      <div style={{ height: '1px', backgroundColor: 'rgba(255,255,255,0.08)', margin: `0 ${spacing[2]}` }} />

      {/* Navigation links */}
      <div style={{ flex: 1, paddingTop: spacing[1] }}>
        {links.map(link => {
          const active = isLinkActive(link, pathname)
          return (
            <Link
              key={link.href}
              href={link.href}
              style={{
                display: 'block',
                padding: '9px 20px',
                fontSize: typography.sizes.sm,
                fontWeight: active ? typography.weights.medium : typography.weights.light,
                color: active ? '#FFFFFF' : 'rgba(255,255,255,0.5)',
                textDecoration: 'none',
                backgroundColor: active ? 'rgba(255,255,255,0.09)' : 'transparent',
                borderLeft: active ? '2px solid rgba(255,255,255,0.7)' : '2px solid transparent',
                letterSpacing: typography.tracking.normal,
              }}
            >
              {link.label}
            </Link>
          )
        })}
      </div>

      {/* Footer */}
      <div
        style={{
          padding: spacing[2],
          borderTop: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        {recordCount !== undefined && (
          <div
            style={{
              fontSize: typography.sizes.xs,
              fontWeight: typography.weights.light,
              color: 'rgba(255,255,255,0.3)',
              marginBottom: spacing[1],
              letterSpacing: typography.tracking.wide,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {recordCount.toLocaleString()} records
          </div>
        )}
        <button
          onClick={() => signOut({ callbackUrl: '/login' })}
          style={{
            width: '100%',
            padding: '7px 12px',
            fontSize: typography.sizes.xs,
            fontWeight: typography.weights.light,
            color: 'rgba(255,255,255,0.4)',
            backgroundColor: 'transparent',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: '3px',
            cursor: 'pointer',
            textAlign: 'left' as const,
            letterSpacing: typography.tracking.wide,
          }}
        >
          Sign out
        </button>
      </div>
    </nav>
  )
}
