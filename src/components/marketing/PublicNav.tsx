'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { colours, typography } from '@/lib/design-system'
import { pilotRequestHref } from '@/lib/marketing/pilot'

const links = [
  { href: '/how-it-works', label: 'How it works' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/about', label: 'About' },
]

export function PublicNav() {
  const pathname = usePathname()
  return <Navigation key={pathname} pathname={pathname} />
}

function Navigation({ pathname }: { pathname: string }) {
  const [open, setOpen] = useState(false)
  const nav = useRef<HTMLElement>(null)
  const toggle = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    function closeOutside(event: PointerEvent) {
      if (!nav.current?.contains(event.target as Node)) setOpen(false)
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      setOpen(false)
      toggle.current?.focus()
    }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  return (
    <nav
      ref={nav}
      aria-label="Main navigation"
      className="mk-nav"
      onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
      }}
      style={{ backgroundColor: colours.surface, borderBottom: `1px solid ${colours.border}` }}
    >
      <div className="mk-site-frame mk-nav-inner">
        <Link href="/" onClick={() => setOpen(false)} style={{ fontSize: typography.sizes.base, fontWeight: typography.weights.medium, color: colours.navy, textDecoration: 'none' }} aria-label="arbor home">
          arbor
        </Link>
        <button
          ref={toggle}
          type="button"
          className="mk-nav-toggle"
          aria-expanded={open}
          aria-controls="mk-nav-menu"
          onClick={() => setOpen(!open)}
        >
          {open ? 'Close menu' : 'Menu'}
        </button>
        <div id="mk-nav-menu" className="mk-nav-menu" data-open={open}>
          <div className="mk-nav-links">
            {links.map(link => (
              <Link key={link.href} href={link.href} aria-current={pathname === link.href ? 'page' : undefined} onClick={() => setOpen(false)}>
                {link.label}
              </Link>
            ))}
          </div>
          <div className="mk-nav-actions">
            <Link href="/login" onClick={() => setOpen(false)}>Sign in</Link>
            <a href={pilotRequestHref()} className="mk-nav-cta" onClick={() => setOpen(false)}>Request pilot access</a>
          </div>
        </div>
      </div>
    </nav>
  )
}
