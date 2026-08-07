// Every screen that sits underneath another screen can be left in one click.
// The parent map is the single source of truth so no sub-page invents its own
// wording or points somewhere the nav does not.

import { parentOf, PORTAL_PARENTS } from '../back-links'
import { getNavLinks } from '../nav'

describe('parentOf', () => {
  it('sends a settings sub-page back to Settings', () => {
    expect(parentOf('/settings/webhooks')).toEqual({ href: '/settings', label: 'Settings' })
    expect(parentOf('/settings/api-keys')).toEqual({ href: '/settings', label: 'Settings' })
  })

  it('sends the request family back to Requests', () => {
    expect(parentOf('/questionnaires')?.href).toBe('/requests')
    expect(parentOf('/inbound-requests')?.href).toBe('/requests')
    expect(parentOf('/shares')?.href).toBe('/requests')
    expect(parentOf('/requests/data')?.href).toBe('/requests')
  })

  it('sends a questionnaire back to the questionnaire list, not straight to Requests', () => {
    // Deepest match wins, so a two-level page steps back one level at a time.
    expect(parentOf('/questionnaires/cdp-climate')).toEqual({
      href: '/questionnaires',
      label: 'Questionnaires',
    })
  })

  it('sends the wordings page back to Records', () => {
    expect(parentOf('/definitions')).toEqual({ href: '/records', label: 'Records' })
  })

  it('sends supply-chain sub-pages back to the entity network', () => {
    expect(parentOf('/supply-chain/request')?.href).toBe('/supply-chain')
    expect(parentOf('/supply-chain/abc123/records')?.href).toBe('/supply-chain')
  })

  it('sends an extraction review back to the documents that produced it', () => {
    expect(parentOf('/upload/doc_123/review')?.href).toBe('/review')
  })

  it('sends reads-not-fills screens back to Settings, where they are linked from', () => {
    expect(parentOf('/activity')?.href).toBe('/settings')
    expect(parentOf('/access')?.href).toBe('/settings')
  })

  it('returns null for a top-level nav destination', () => {
    for (const href of ['/dashboard', '/upload', '/review', '/records', '/requests', '/settings', '/export', '/supply-chain']) {
      expect(parentOf(href)).toBeNull()
    }
  })

  it('returns null for an unknown path rather than guessing', () => {
    expect(parentOf('/not-a-real-page')).toBeNull()
  })

  it('ignores a trailing slash', () => {
    expect(parentOf('/definitions/')).toEqual({ href: '/records', label: 'Records' })
  })

  it('never points a sub-page at itself', () => {
    for (const [path, parent] of Object.entries(PORTAL_PARENTS)) {
      expect(parent.href).not.toBe(path)
    }
  })

  it('only ever points at a page that exists in one of the navs', () => {
    const known = new Set([
      ...getNavLinks('SUPPLIER').map(l => l.href),
      ...getNavLinks('BUYER').map(l => l.href),
      // Grouped routes are reachable destinations too, even without a nav slot.
      '/questionnaires',
    ])
    for (const parent of Object.values(PORTAL_PARENTS)) {
      expect(known.has(parent.href)).toBe(true)
    }
  })
})
