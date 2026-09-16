import { presentGoodsLine, presentGoodsLines } from '../goods-line-presenter'

describe('presentGoodsLine', () => {
  it('formats mass in tonnes and emissions as a total', () => {
    const p = presentGoodsLine(
      {
        id: 'gl-1',
        cn_code: '72081000',
        net_mass_kg: 24000,
        direct_kgco2e: 43200,
        indirect_kgco2e: 1800,
        origin_country: 'IN',
      },
      0,
    )
    expect(p.mass).toBe('24.00 t')
    expect(p.declaredEmissions).toBe('45.00 tCO2e')
    expect(p.origin).toBe('IN')
    expect(p.position).toBe(1)
  })

  // A zero on a declaration line reads as "these goods produced no emissions".
  // The opposite of "nobody has said yet", and it would file as the former.
  it('shows an em-dash, not a zero, when no figure has been supplied', () => {
    const p = presentGoodsLine({ id: 'gl-1', cn_code: '72081000', net_mass_kg: 1000 }, 0)
    expect(p.declaredEmissions).toBe('—')
    expect(p.emissionsNeeded).toMatch(/No emissions figure yet/)
  })

  // Adding the two with direct standing in as zero would render a confident,
  // complete-looking total that understates the line by all of its direct
  // emissions — and the UK charges direct emissions alone.
  it('shows no total when only the electricity figure has been given', () => {
    const p = presentGoodsLine(
      { id: 'gl-1', cn_code: '72081000', net_mass_kg: 1000, indirect_kgco2e: 1800 },
      0,
    )
    expect(p.declaredEmissions).toBe('—')
    expect(p.emissionsNeeded).toMatch(/direct emissions/i)
  })

  it('says nothing extra once a figure exists', () => {
    const p = presentGoodsLine({ id: 'gl-1', cn_code: '72081000', direct_kgco2e: 100 }, 0)
    expect(p.emissionsNeeded).toBeNull()
  })

  // A 6-digit HS heading carries no sector and no default value, so a line with
  // one cannot be declared at all.
  it('flags a commodity code that is not the full eight digits', () => {
    expect(presentGoodsLine({ cn_code: '720810' }, 0).cnCodeIncomplete).toBe(true)
    expect(presentGoodsLine({ cn_code: '72081000' }, 0).cnCodeIncomplete).toBe(false)
  })

  it('does not flag a missing code as incomplete — it is missing, which is different', () => {
    const p = presentGoodsLine({ cn_code: null }, 0)
    expect(p.cnCode).toBe('—')
    expect(p.cnCodeIncomplete).toBe(false)
  })

  it('accepts mass under either column name', () => {
    expect(presentGoodsLine({ quantity: 5000 }, 0).mass).toBe('5.00 t')
  })

  it('prefers an installation name over its id', () => {
    expect(
      presentGoodsLine({ installation_id: 'INST-1', installation_name: 'Bhilai Works' }, 0)
        .installation,
    ).toBe('Bhilai Works')
    expect(presentGoodsLine({ installation_id: 'INST-1' }, 0).installation).toBe('INST-1')
  })
})

describe('presentGoodsLines', () => {
  it('numbers lines from one', () => {
    const rows = presentGoodsLines([{ cn_code: 'a' }, { cn_code: 'b' }])
    expect(rows.map(r => r.position)).toEqual([1, 2])
  })

  it('handles a case with no goods lines', () => {
    expect(presentGoodsLines(undefined)).toEqual([])
  })
})
