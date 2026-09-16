import { buildDeclarationPayload, toProvenanceTier } from '../declaration-payload'

const BASE = {
  caseReference: 'case-1',
  entityId: 'ent-1',
  jurisdiction: 'UK' as const,
  reportingYear: 2027,
  reportingQuarter: 1,
  provenanceTier: 'VERIFIED' as const,
}

describe('buildDeclarationPayload', () => {
  it('turns case goods lines into declaration lines', () => {
    const { payload, problems } = buildDeclarationPayload({
      ...BASE,
      goodsLines: [
        {
          id: 'gl-1',
          cn_code: '72081000',
          net_mass_kg: 24000,
          origin_country: 'IN',
          direct_kgco2e: 43200,
          method: 'actual',
        },
      ],
    })

    expect(problems).toEqual([])
    expect(payload!.lines).toHaveLength(1)
    expect(payload!.lines[0]).toMatchObject({
      line_id: 'gl-1',
      cn_code: '72081000',
      net_mass_kg: 24000,
      direct_embedded_kgco2e: 43200,
      declared_emissions_method: 'ACTUAL',
    })
  })

  // The two axes are orthogonal. The provenance tier is Arbor's, set by a human
  // in Review, and travels on the line so the result can display both together.
  it('stamps the human-set provenance tier on every line, whatever the method', () => {
    const { payload } = buildDeclarationPayload({
      ...BASE,
      provenanceTier: 'DECLARED',
      goodsLines: [
        { id: 'a', cn_code: '72081000', quantity: 1000, method: 'actual' },
        { id: 'b', cn_code: '76011000', quantity: 500, method: 'default' },
      ],
    })

    expect(payload!.lines.map(l => l.provenance_tier)).toEqual(['DECLARED', 'DECLARED'])
    expect(payload!.lines.map(l => l.declared_emissions_method)).toEqual(['ACTUAL', 'DEFAULT'])
  })

  // Column names differ by schema generation and the case endpoint returns
  // whichever the database has.
  it('accepts mass under either column name', () => {
    const { payload } = buildDeclarationPayload({
      ...BASE,
      goodsLines: [{ id: 'gl-1', cn_code: '72081000', quantity: '18000' }],
    })
    expect(payload!.lines[0].net_mass_kg).toBe(18000)
  })

  it('names a line it cannot calculate rather than dropping it quietly', () => {
    const { payload, problems } = buildDeclarationPayload({
      ...BASE,
      goodsLines: [
        { id: 'gl-1', cn_code: '72081000', net_mass_kg: 24000 },
        { id: 'gl-2', cn_code: null, net_mass_kg: 500 },
      ],
    })

    expect(payload!.lines).toHaveLength(1)
    expect(problems.join(' ')).toMatch(/Goods line 2/)
    expect(problems.join(' ')).toMatch(/commodity code/)
  })

  it('returns no payload when no line can be calculated', () => {
    const { payload, problems } = buildDeclarationPayload({ ...BASE, goodsLines: [] })
    expect(payload).toBeNull()
    expect(problems.join(' ')).toMatch(/no goods line/i)
  })

  // Sending a method the engine does not know would be rejected over the wire
  // with a 422 and the whole declaration would fail. Leaving it unset lets the
  // selector choose and record its reasoning.
  it('drops an unrecognised declared method and says so', () => {
    const { payload, problems } = buildDeclarationPayload({
      ...BASE,
      goodsLines: [{ id: 'gl-1', cn_code: '72081000', net_mass_kg: 100, method: 'vibes' }],
    })

    expect(payload!.lines[0].declared_emissions_method).toBeNull()
    expect(problems.join(' ')).toMatch(/vibes/i)
  })

  it('gives a line with no id a stable positional one', () => {
    const { payload } = buildDeclarationPayload({
      ...BASE,
      goodsLines: [{ cn_code: '72081000', net_mass_kg: 100 }],
    })
    expect(payload!.lines[0].line_id).toBe('line-1')
  })
})

describe('toProvenanceTier', () => {
  it('maps Arbor trust tiers onto the contract axis', () => {
    expect(toProvenanceTier('A')).toBe('VERIFIED')
    expect(toProvenanceTier('B')).toBe('DECLARED')
    expect(toProvenanceTier('C')).toBe('ESTIMATED')
  })

  // Declared claims only that someone stated the figure, which is true of every
  // record. Falling back to Verified would assert evidence that is not there.
  it('falls back to Declared for anything unrecognised', () => {
    expect(toProvenanceTier(null)).toBe('DECLARED')
    expect(toProvenanceTier(undefined)).toBe('DECLARED')
    expect(toProvenanceTier('Z')).toBe('DECLARED')
  })
})
