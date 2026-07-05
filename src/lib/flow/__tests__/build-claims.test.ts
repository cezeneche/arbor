import { buildCertificateClaims, type RawClaim } from '../build-claims'

// Upgrade 9 — one claim per (reference, claimant): the same certificate re-uploaded
// by one entity counts once; the same certificate under two entities counts twice
// (the double-counting signal).

describe('buildCertificateClaims', () => {
  it('deduplicates repeated (ref, claimant) pairs', () => {
    const rows: RawClaim[] = [
      { ref: 'REGO-1', claimant: 'e1' },
      { ref: 'REGO-1', claimant: 'e1' },
    ]
    expect(buildCertificateClaims(rows)).toEqual([{ ref: 'REGO-1', claimant: 'e1' }])
  })

  it('keeps the same reference under different claimants (the fraud signal)', () => {
    const claims = buildCertificateClaims([
      { ref: 'REGO-1', claimant: 'e1' },
      { ref: 'REGO-1', claimant: 'e2' },
    ])
    expect(claims).toHaveLength(2)
    expect(claims.map(c => c.claimant).sort()).toEqual(['e1', 'e2'])
  })

  it('skips blank / null references', () => {
    expect(buildCertificateClaims([{ ref: null, claimant: 'e1' }, { ref: '  ', claimant: 'e1' }])).toEqual([])
  })
})
