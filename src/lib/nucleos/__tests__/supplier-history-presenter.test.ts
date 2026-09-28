import { presentSupplierHistory } from '../supplier-history-presenter'

// A supplier's earlier figures beside the one on a goods line. Nucleos decides
// whether the figure departs from them; this only says so in plain words.

const base = {
  goods_line_id: 'gl-1',
  installation_id: 'INST-7',
  cn_code: '72081000',
  current_see_tco2e_per_t: '1.9',
  threshold_pct: '0.30',
  min_history: 3,
  rolling_mean: null,
  deviation_pct: null,
  flagged: false,
  note: null,
}

const past = (period: string, see: string, method = 'actual') => ({
  case_id: `case-${period}`,
  goods_line_id: `gl-${period}`,
  reporting_period: period,
  see_tco2e_per_t: see,
  method,
})

describe('presentSupplierHistory', () => {
  it('flags a figure far from the installation’s average, and says by how much', () => {
    const out = presentSupplierHistory({
      ...base,
      current_see_tco2e_per_t: '2.9',
      history: [past('2027-Q1', '1.8'), past('2027-Q2', '1.9'), past('2027-Q3', '2', 'estimated')],
      rolling_mean: '1.9',
      deviation_pct: '0.5263',
      flagged: true,
    })
    expect(out).toEqual({
      available: true,
      flagged: true,
      current: '2.900 tCO₂e per tonne',
      verdict:
        'This figure is 53% away from the average of this installation’s earlier figures (1.900 tCO₂e per tonne). Check it with the supplier before relying on it.',
      rows: [
        { period: '2027-Q1', value: '1.800 tCO₂e per tonne', source: 'Supplier’s figure' },
        { period: '2027-Q2', value: '1.900 tCO₂e per tonne', source: 'Supplier’s figure' },
        { period: '2027-Q3', value: '2.000 tCO₂e per tonne', source: 'Supplier’s estimate' },
      ],
    })
  })

  it('says a figure is in line without working out a deviation of its own', () => {
    const out = presentSupplierHistory({
      ...base,
      history: [past('2027-Q1', '1.8'), past('2027-Q2', '1.9'), past('2027-Q3', '2')],
      rolling_mean: '1.9',
    })
    expect(out.flagged).toBe(false)
    expect(out.verdict).toBe(
      'Within 30% of the average of this installation’s earlier figures (1.900 tCO₂e per tonne).',
    )
  })

  it('says when there are too few earlier figures to compare', () => {
    const out = presentSupplierHistory({ ...base, history: [past('2027-Q1', '1.8')] })
    expect(out.verdict).toBe(
      'One earlier figure from this installation. At least 3 are needed before this figure can be compared.',
    )
    expect(out.rows).toHaveLength(1)
  })

  it('says when this is the first figure from the installation', () => {
    expect(presentSupplierHistory({ ...base, history: [] }).verdict).toBe(
      'This is the first figure from this installation for these goods.',
    )
  })

  it('says when the line has no supplier figure, so there is nothing to compare', () => {
    const out = presentSupplierHistory({
      ...base,
      current_see_tco2e_per_t: null,
      history: [past('2027-Q1', '1.8'), past('2027-Q2', '1.9'), past('2027-Q3', '2')],
      rolling_mean: '1.9',
    })
    expect(out.current).toBeNull()
    expect(out.verdict).toBe(
      'These goods have no supplier figure yet, so there is nothing to compare with the installation’s earlier figures.',
    )
  })

  it('passes on why no history can be found', () => {
    const note = 'No installation is recorded for this goods line, so its supplier’s history cannot be found.'
    expect(presentSupplierHistory({ ...base, installation_id: null, history: [], note })).toMatchObject({
      available: false,
      verdict: note,
    })
  })

  it('treats a missing answer as nothing to show', () => {
    expect(presentSupplierHistory(null)).toEqual({
      available: false,
      flagged: false,
      current: null,
      verdict: 'No history could be found for these goods.',
      rows: [],
    })
  })
})
