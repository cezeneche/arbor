import { describeMatch } from '../match-view'

// What an operator needs to settle a proposed match: how alike the names are,
// and which identity details agree or conflict. A conflicting registration
// number is the strongest sign two names are different companies.

const base = { legalName: 'Acme Steel Ltd', registrationNumber: null, country: null, sector: null }

it('shows similarity as a whole percentage', () => {
  expect(describeMatch({ similarity: 0.917, entityA: base, entityB: base }).percent).toBe(92)
})

it('lists the details both companies share', () => {
  const a = { ...base, registrationNumber: '01234567', country: 'GB', sector: 'Steel' }
  const b = {
    ...base,
    legalName: 'ACME STEEL LIMITED',
    registrationNumber: '01234567',
    country: 'GB',
    sector: 'Steel',
  }
  const view = describeMatch({ similarity: 0.9, entityA: a, entityB: b })
  expect(view.agreements).toEqual(['Same registration number', 'Same country', 'Same sector'])
  expect(view.conflicts).toEqual([])
})

it('flags details that conflict', () => {
  const a = { ...base, registrationNumber: '01234567', country: 'GB' }
  const b = { ...base, registrationNumber: '07654321', country: 'DE' }
  const view = describeMatch({ similarity: 0.9, entityA: a, entityB: b })
  expect(view.conflicts).toEqual(['Different registration numbers', 'Different countries'])
})

it('says nothing about a detail only one side has', () => {
  const view = describeMatch({
    similarity: 0.9,
    entityA: { ...base, country: 'GB' },
    entityB: base,
  })
  expect(view.agreements).toEqual([])
  expect(view.conflicts).toEqual([])
})

it('compares registration numbers and countries without case or spacing differences', () => {
  const view = describeMatch({
    similarity: 0.9,
    entityA: { ...base, registrationNumber: 'sc 123456', country: 'gb' },
    entityB: { ...base, registrationNumber: 'SC123456', country: 'GB' },
  })
  expect(view.agreements).toEqual(['Same registration number', 'Same country'])
})
