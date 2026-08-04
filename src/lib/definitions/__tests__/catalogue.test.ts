// The seed dictionary. Its job is coverage: every field that can reach a buyer
// must have a plain-English wording attached, or the "definitions travel with the
// data" guarantee has holes in exactly the places it matters.

import { SEED_DEFINITIONS, seedDefinitionsAsStored } from '../catalogue'
import { NUMERIC_FIELDS } from '@/lib/review/review-policy'
import { SUPPORTED_UNITS } from '@/lib/layer3/unit-conversion'

// The keys of SUPPORTED_UNITS are the SI base units values are stored in.
const SI_BASE_UNITS = Object.keys(SUPPORTED_UNITS)

describe('SEED_DEFINITIONS', () => {
  it('covers every field that can become a stored DataRecord', () => {
    // NUMERIC_FIELDS is the set the review pipeline promotes into the store, so
    // it is exactly the set a buyer can be sent. Any gap here is a number that
    // would travel without its meaning.
    const defined = new Set(SEED_DEFINITIONS.map(d => d.fieldName))
    const missing = [...NUMERIC_FIELDS].filter(f => !defined.has(f))
    expect(missing).toEqual([])
  })

  it('gives every definition a plain-English label, definition and boundary', () => {
    for (const d of SEED_DEFINITIONS) {
      expect(d.label.length).toBeGreaterThan(0)
      expect(d.definition.length).toBeGreaterThan(20)
      expect(d.boundary.length).toBeGreaterThan(20)
    }
  })

  it('states an inclusion and an exclusion in every boundary', () => {
    // "What is counted" without "what is not" is where two companies quietly
    // disagree while both believing they agree.
    for (const d of SEED_DEFINITIONS) {
      expect(d.boundary).toMatch(/includes/i)
      expect(d.boundary).toMatch(/excludes/i)
    }
  })

  it('uses only SI base units the conversion engine recognises', () => {
    for (const d of SEED_DEFINITIONS) {
      if (d.canonicalUnit === null) continue
      expect(SI_BASE_UNITS).toContain(d.canonicalUnit)
    }
  })

  it('cites the standard the wording came from', () => {
    for (const d of SEED_DEFINITIONS) {
      expect(d.sourceStandard).toBeTruthy()
    }
  })

  it('keys definitions by field AND domain, so a shared field name can differ per domain', () => {
    // "quantity" on a fuel receipt is not "quantity" on a waste transfer note.
    const quantityDefs = SEED_DEFINITIONS.filter(d => d.fieldName === 'quantity')
    expect(quantityDefs.length).toBeGreaterThan(1)
    const domains = new Set(quantityDefs.map(d => d.domain))
    expect(domains.size).toBe(quantityDefs.length)
  })

  it('has no duplicate field+domain pair', () => {
    const keys = SEED_DEFINITIONS.map(d => `${d.domain} ${d.fieldName}`)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('seedDefinitionsAsStored', () => {
  it('publishes everything as version 1, open-ended, from the given instant', () => {
    const from = new Date('2026-01-01T00:00:00.000Z')
    const stored = seedDefinitionsAsStored(from)
    expect(stored).toHaveLength(SEED_DEFINITIONS.length)
    for (const d of stored) {
      expect(d.version).toBe(1)
      expect(d.effectiveFrom).toEqual(from)
      expect(d.effectiveTo).toBeNull()
    }
  })

  it('derives a stable id from field and domain so re-seeding is idempotent', () => {
    const a = seedDefinitionsAsStored(new Date('2026-01-01T00:00:00.000Z'))
    const b = seedDefinitionsAsStored(new Date('2026-05-05T00:00:00.000Z'))
    expect(a.map(d => d.id)).toEqual(b.map(d => d.id))
  })
})
