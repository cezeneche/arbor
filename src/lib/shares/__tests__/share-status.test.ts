import { shareState, isShareViewable } from '../share-status'

const NOW = new Date('2026-06-20T12:00:00.000Z')

describe('shareState', () => {
  it('is active when neither revoked nor expired', () => {
    expect(shareState({ revokedAt: null, expiresAt: null }, NOW)).toBe('active')
  })

  it('is active when expiry is in the future', () => {
    expect(shareState({ expiresAt: '2026-12-31T00:00:00.000Z' }, NOW)).toBe('active')
  })

  it('is revoked when revokedAt is set, regardless of expiry', () => {
    expect(shareState({ revokedAt: '2026-06-01T00:00:00.000Z', expiresAt: '2026-12-31T00:00:00.000Z' }, NOW)).toBe('revoked')
  })

  it('is expired when expiry is in the past', () => {
    expect(shareState({ expiresAt: '2026-01-01T00:00:00.000Z' }, NOW)).toBe('expired')
  })

  it('treats an expiry exactly at now as expired', () => {
    expect(shareState({ expiresAt: NOW }, NOW)).toBe('expired')
  })

  it('isShareViewable is true only for active shares', () => {
    expect(isShareViewable({ revokedAt: null, expiresAt: null }, NOW)).toBe(true)
    expect(isShareViewable({ revokedAt: NOW }, NOW)).toBe(false)
    expect(isShareViewable({ expiresAt: '2025-01-01T00:00:00.000Z' }, NOW)).toBe(false)
  })
})
