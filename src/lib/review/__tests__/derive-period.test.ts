// A record's period must be a deterministic function of the DOCUMENT, never of
// when someone happened to upload it.
//
// The production bug: a customs declaration carries no period_start/period_end,
// so the period fell back to `now - 365 days → now` at millisecond precision.
// The same declaration uploaded twice, two hours apart, produced two different
// periods. Supersession matches on exact entity+domain+fieldName+period, so it
// missed, and both records stayed active — a silent double count, which is the
// precise failure the duplication check (PRD §11.4) exists to prevent.
//
// 12 of the 20 record-producing document types have no period fields, so this
// was the majority case, not an edge case.

import { derivePeriod } from '../review-policy'

const at = (iso: string) => new Date(iso)

describe('derivePeriod — determinism', () => {
  it('yields the same period for the same document however long apart the uploads are', () => {
    // The regression test for the actual production defect.
    const values = { declaration_date: '2026-03-14' }
    const first = derivePeriod(values, {
      now: at('2026-07-01T20:39:49.709Z'),
      documentType: 'CUSTOMS_DECLARATION',
    })
    const second = derivePeriod(values, {
      now: at('2026-07-01T22:28:11.260Z'),
      documentType: 'CUSTOMS_DECLARATION',
    })

    expect(second.periodStart.getTime()).toBe(first.periodStart.getTime())
    expect(second.periodEnd.getTime()).toBe(first.periodEnd.getTime())
  })

  it('does not anchor the period to upload time when the document states a date', () => {
    const { periodStart, periodEnd } = derivePeriod(
      { declaration_date: '2026-03-14' },
      { now: at('2026-07-01T22:28:11.260Z'), documentType: 'CUSTOMS_DECLARATION' },
    )
    expect(periodStart.toISOString()).toBe('2026-03-14T00:00:00.000Z')
    expect(periodEnd.toISOString()).toBe('2026-03-14T23:59:59.999Z')
  })
})

describe('derivePeriod — explicit period fields win', () => {
  it('uses period_start / period_end when both are present', () => {
    const { periodStart, periodEnd } = derivePeriod(
      { period_start: '2026-01-01', period_end: '2026-03-31' },
      { now: at('2026-06-20T00:00:00.000Z'), documentType: 'ELECTRICITY_BILL' },
    )
    expect(periodStart.toISOString().slice(0, 10)).toBe('2026-01-01')
    expect(periodEnd.toISOString().slice(0, 10)).toBe('2026-03-31')
  })

  it('honours the production_period_* spelling', () => {
    const { periodStart, periodEnd } = derivePeriod(
      { production_period_start: '2025-01-01', production_period_end: '2025-12-31' },
      { now: at('2026-06-20T00:00:00.000Z'), documentType: 'CBAM_DECLARATION' },
    )
    expect(periodStart.toISOString().slice(0, 10)).toBe('2025-01-01')
    expect(periodEnd.toISOString().slice(0, 10)).toBe('2025-12-31')
  })

  it('falls through to the document date when a period field is present but blank', () => {
    // The second trigger: extraction failed to read the period, and the old code
    // silently substituted upload time.
    const { periodStart } = derivePeriod(
      { period_start: '', period_end: '', invoice_date: '2026-02-09' },
      { now: at('2026-07-01T22:28:11.260Z'), documentType: 'SUPPLIER_INVOICE' },
    )
    expect(periodStart.toISOString()).toBe('2026-02-09T00:00:00.000Z')
  })
})

describe('derivePeriod — per document type anchor date', () => {
  // The anchor is when the ACTIVITY happened, not when the paperwork was filed.
  const cases: [string, Record<string, string>, string][] = [
    ['FUEL_RECEIPT', { purchase_date: '2026-04-02' }, '2026-04-02'],
    ['MATERIAL_INTAKE', { delivery_date: '2026-04-03' }, '2026-04-03'],
    ['CUSTOMS_DECLARATION', { declaration_date: '2026-04-04' }, '2026-04-04'],
    ['BILL_OF_LADING', { date_of_issue: '2026-04-05' }, '2026-04-05'],
    ['SUPPLIER_INVOICE', { invoice_date: '2026-04-06' }, '2026-04-06'],
    ['CROP_YIELD_RECORD', { harvest_date: '2026-04-07' }, '2026-04-07'],
    ['FERTILISER_RECORD', { application_date: '2026-04-08' }, '2026-04-08'],
    ['LAND_USE_CERTIFICATE', { issue_date: '2026-04-09' }, '2026-04-09'],
  ]

  it.each(cases)('anchors %s to its own date field', (documentType, values, expected) => {
    const { periodStart } = derivePeriod(values, {
      now: at('2026-07-01T22:28:11.260Z'),
      documentType,
    })
    expect(periodStart.toISOString().slice(0, 10)).toBe(expected)
  })

  it('prefers the shipment date over the invoice date on a freight invoice', () => {
    // The movement is the activity; the invoice date is when it was billed.
    const { periodStart } = derivePeriod(
      { shipment_date: '2026-04-10', invoice_date: '2026-05-20' },
      { now: at('2026-07-01T00:00:00.000Z'), documentType: 'FREIGHT_INVOICE' },
    )
    expect(periodStart.toISOString().slice(0, 10)).toBe('2026-04-10')
  })
})

describe('derivePeriod — year-only documents cover the whole calendar year', () => {
  it('uses data_year on a carbon footprint report, not its publication date', () => {
    // The report's figures describe the data year. Publication is just when it
    // was written up.
    const { periodStart, periodEnd } = derivePeriod(
      { data_year: '2025', publication_date: '2026-05-01' },
      { now: at('2026-07-01T00:00:00.000Z'), documentType: 'CARBON_FOOTPRINT_REPORT' },
    )
    expect(periodStart.toISOString()).toBe('2025-01-01T00:00:00.000Z')
    expect(periodEnd.toISOString()).toBe('2025-12-31T23:59:59.999Z')
  })

  it('uses reporting_year on emissions factor documentation', () => {
    const { periodStart } = derivePeriod(
      { reporting_year: '2024', publication_year: '2025' },
      { now: at('2026-07-01T00:00:00.000Z'), documentType: 'EMISSIONS_FACTOR_DOC' },
    )
    expect(periodStart.toISOString()).toBe('2024-01-01T00:00:00.000Z')
  })

  it('uses vintage_year on a renewable certificate, not its expiry', () => {
    // Vintage is the generation year — the activity. Expiry is an admin deadline.
    const { periodStart } = derivePeriod(
      { vintage_year: '2025', expiry_date: '2027-01-01' },
      { now: at('2026-07-01T00:00:00.000Z'), documentType: 'RENEWABLE_CERTIFICATE' },
    )
    expect(periodStart.toISOString()).toBe('2025-01-01T00:00:00.000Z')
  })
})

describe('derivePeriod — last resort', () => {
  it('truncates the fallback window to whole days so it is stable within a day', () => {
    // Nothing in the document states a period. The window is still deterministic
    // for every upload that day, so a same-day re-upload supersedes rather than
    // duplicating.
    const morning = derivePeriod({}, { now: at('2026-07-01T06:00:00.000Z') })
    const evening = derivePeriod({}, { now: at('2026-07-01T23:12:45.123Z') })

    expect(morning.periodStart.toISOString()).toBe('2025-07-01T00:00:00.000Z')
    expect(morning.periodEnd.toISOString()).toBe('2026-07-01T23:59:59.999Z')
    expect(evening.periodStart.getTime()).toBe(morning.periodStart.getTime())
    expect(evening.periodEnd.getTime()).toBe(morning.periodEnd.getTime())
  })

  it('ignores an unparseable date rather than writing an Invalid Date', () => {
    const { periodStart } = derivePeriod(
      { declaration_date: 'not a date' },
      { now: at('2026-07-01T06:00:00.000Z'), documentType: 'CUSTOMS_DECLARATION' },
    )
    expect(Number.isNaN(periodStart.getTime())).toBe(false)
    expect(periodStart.toISOString()).toBe('2025-07-01T00:00:00.000Z')
  })

  it('works with no document type at all', () => {
    const { periodEnd } = derivePeriod({}, { now: at('2026-07-01T06:00:00.000Z') })
    expect(periodEnd.toISOString()).toBe('2026-07-01T23:59:59.999Z')
  })
})
