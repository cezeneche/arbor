import {
  classifyCertificateExpiry,
  certificateFlagReason,
  certificateCoversPeriod,
  EXPIRY_WARNING_DAYS,
} from '../certificate-expiry'

const TODAY = new Date('2026-08-08T00:00:00Z')

describe('classifyCertificateExpiry', () => {
  it('is VALID well before expiry', () => {
    expect(classifyCertificateExpiry('2027-01-01', TODAY).state).toBe('VALID')
  })

  it('is EXPIRING inside the warning window', () => {
    expect(classifyCertificateExpiry('2026-08-20', TODAY).state).toBe('EXPIRING')
  })

  it('is EXPIRED once the date has passed', () => {
    expect(classifyCertificateExpiry('2026-08-07', TODAY).state).toBe('EXPIRED')
  })

  it('is UNREADABLE for a missing or unparseable date rather than guessing', () => {
    expect(classifyCertificateExpiry(null, TODAY).state).toBe('UNREADABLE')
    expect(classifyCertificateExpiry('sometime next year', TODAY).state).toBe('UNREADABLE')
  })

  it('sits on the boundary of the warning window', () => {
    const justInside = new Date(TODAY)
    justInside.setDate(justInside.getDate() + EXPIRY_WARNING_DAYS - 1)
    expect(classifyCertificateExpiry(justInside.toISOString(), TODAY).state).toBe('EXPIRING')

    const justOutside = new Date(TODAY)
    justOutside.setDate(justOutside.getDate() + EXPIRY_WARNING_DAYS + 1)
    expect(classifyCertificateExpiry(justOutside.toISOString(), TODAY).state).toBe('VALID')
  })

  // The defect this closes: a field warned about in one run was flagged and then
  // excluded from every later run, so it never became EXPIRED. Classification
  // depends only on the date and the day it is run, never on the existing flag.
  it('re-classifies the same certificate as time passes', () => {
    const expiry = '2026-08-20'
    expect(classifyCertificateExpiry(expiry, new Date('2026-06-01')).state).toBe('VALID')
    expect(classifyCertificateExpiry(expiry, new Date('2026-08-01')).state).toBe('EXPIRING')
    expect(classifyCertificateExpiry(expiry, new Date('2026-09-01')).state).toBe('EXPIRED')
  })
})

describe('certificateFlagReason', () => {
  it('produces a distinct reason per state, so a change of state is detectable', () => {
    const expiring = certificateFlagReason('EXPIRING', '2026-08-20', 12)
    const expired = certificateFlagReason('EXPIRED', '2026-08-20')
    expect(expiring).not.toBe(expired)
    expect(expired).toContain('expired')
    expect(expiring).toContain('12 days')
  })

  it('has no reason for a valid certificate', () => {
    expect(certificateFlagReason('VALID', '2027-01-01')).toBeNull()
    expect(certificateFlagReason('UNREADABLE', '')).toBeNull()
  })
})

describe('certificateCoversPeriod', () => {
  it('covers a period that ends before the certificate lapses', () => {
    expect(certificateCoversPeriod(new Date('2026-12-31'), new Date('2026-06-30'))).toBe(true)
  })

  it('covers a period ending exactly on the expiry date', () => {
    expect(certificateCoversPeriod(new Date('2026-06-30'), new Date('2026-06-30'))).toBe(true)
  })

  // The record was true for its own period; an expiry afterwards does not
  // retrospectively falsify it, which is why only the uncovered case is flagged.
  it('does not cover a period that runs past the expiry date', () => {
    expect(certificateCoversPeriod(new Date('2026-06-30'), new Date('2026-12-31'))).toBe(false)
  })
})
