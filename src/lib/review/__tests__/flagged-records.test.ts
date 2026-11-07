import { toFlaggedRecordItems, type FlaggedRecordRow } from '../flagged-records'

// Review's second list: saved records with an open flag, in the words a
// supplier uses. The value is shown as they entered or uploaded it, not in the
// unit it is stored in, because that is the unit a correction is typed in.

function row(over: Partial<FlaggedRecordRow> = {}): FlaggedRecordRow {
  return {
    id: 'flag-1',
    severity: 'WARNING',
    message: 'Two documents disagree: 41,200 kWh against 44,900 kWh.',
    dueAt: null,
    dataRecord: {
      domain: 'ENERGY',
      fieldName: 'electricity_kwh',
      value: 148320,
      unit: 'mj',
      originalValue: 41200,
      originalUnit: 'kWh',
      periodStart: new Date('2026-07-01T00:00:00Z'),
      periodEnd: new Date('2026-09-30T00:00:00Z'),
    },
    ...over,
  }
}

const NOW = new Date('2026-11-07T12:00:00Z')

it('describes the record and the problem in plain words', () => {
  const [item] = toFlaggedRecordItems([row()], NOW)
  expect(item).toMatchObject({
    flagId: 'flag-1',
    period: 'Jul 2026 – Sep 2026',
    value: '41,200',
    unit: 'kWh',
    message: 'Two documents disagree: 41,200 kWh against 44,900 kWh.',
    canKeep: true,
    mustFix: false,
    overdue: false,
  })
  expect(item.title).not.toContain('_')
})

it('does not offer a note for a critical flag', () => {
  const [item] = toFlaggedRecordItems([row({ severity: 'CRITICAL' })], NOW)
  expect(item.canKeep).toBe(false)
  expect(item.mustFix).toBe(true)
})

it('marks a flag past its deadline', () => {
  const [item] = toFlaggedRecordItems([row({ dueAt: new Date('2026-11-01T00:00:00Z') })], NOW)
  expect(item.overdue).toBe(true)
})

it('puts critical flags first, then the soonest deadline', () => {
  const items = toFlaggedRecordItems(
    [
      row({ id: 'later', dueAt: new Date('2026-11-20T00:00:00Z') }),
      row({ id: 'none' }),
      row({ id: 'critical', severity: 'CRITICAL', dueAt: new Date('2026-11-30T00:00:00Z') }),
      row({ id: 'sooner', dueAt: new Date('2026-11-10T00:00:00Z') }),
    ],
    NOW,
  )
  expect(items.map(i => i.flagId)).toEqual(['critical', 'sooner', 'later', 'none'])
})

it('shows the stored value for an older record with no original', () => {
  const [item] = toFlaggedRecordItems(
    [row({ dataRecord: { ...row().dataRecord, originalValue: null, originalUnit: null } })],
    NOW,
  )
  expect(item).toMatchObject({ value: '148,320', unit: 'mj' })
})

it('shows one month once', () => {
  const [item] = toFlaggedRecordItems(
    [
      row({
        dataRecord: {
          ...row().dataRecord,
          periodStart: new Date('2026-08-01T00:00:00Z'),
          periodEnd: new Date('2026-08-31T00:00:00Z'),
        },
      }),
    ],
    NOW,
  )
  expect(item.period).toBe('Aug 2026')
})
