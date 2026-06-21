import { tierLabel } from '@/lib/tier-label'

// Design rule: SME supplier-facing screens show only plain English — no tier
// codes. Buyer-facing screens show full technical detail, including the code.
describe('tierLabel', () => {
  it('supplier (plain) shows only the plain-English label, no A/B/C code', () => {
    expect(tierLabel('A', { plain: true })).toBe('Verified')
    expect(tierLabel('B', { plain: true })).toBe('Declared')
    expect(tierLabel('C', { plain: true })).toBe('Estimated')
  })

  it('buyer (full detail) shows the tier code alongside the label', () => {
    expect(tierLabel('A')).toBe('A · Verified')
    expect(tierLabel('B')).toBe('B · Declared')
    expect(tierLabel('C')).toBe('C · Estimated')
  })
})
