import {
  normaliseIdentityName,
  normaliseRegistration,
  blockingKeys,
  candidatePairs,
  type BlockableEntity,
} from '../blocking'

// entity-resolution baseline, blocking layer. Pure and
// dependency-free. Blocking is the O(n log n) reducer: it groups entities that
// could plausibly be the same real-world company (shared registration number,
// or same country+sector) so the expensive similarity step only ever compares
// within a block, never across the whole corpus. No embeddings here — this is
// deterministic string logic that holds regardless of the embedding choice.

describe('normaliseIdentityName', () => {
  it('lowercases, trims, and collapses whitespace', () => {
    expect(normaliseIdentityName('  Acme   Steel  ')).toBe('acme steel')
  })

  it('strips common legal designators wherever they appear', () => {
    expect(normaliseIdentityName('Acme Steel Ltd')).toBe('acme steel')
    expect(normaliseIdentityName('Acme Steel Limited')).toBe('acme steel')
    expect(normaliseIdentityName('Acme Steel PLC')).toBe('acme steel')
    expect(normaliseIdentityName('Acme Steel GmbH')).toBe('acme steel')
    expect(normaliseIdentityName('Acme Steel, Inc.')).toBe('acme steel')
  })

  it('normalises punctuation and ampersands and drops connective stopwords', () => {
    expect(normaliseIdentityName('Acme-Steel & Co.')).toBe('acme steel')
    expect(normaliseIdentityName('The Acme Steel Company')).toBe('acme steel')
  })

  it('leaves a distinctive name that is only designators as empty', () => {
    expect(normaliseIdentityName('Ltd')).toBe('')
  })

  it('collapses two spellings of the same company to the same string', () => {
    expect(normaliseIdentityName('ACME STEEL LIMITED')).toBe(
      normaliseIdentityName('Acme Steel Ltd.'),
    )
  })
})

describe('normaliseRegistration', () => {
  it('uppercases and removes spacing and punctuation', () => {
    expect(normaliseRegistration('sc 123-456')).toBe('SC123456')
    expect(normaliseRegistration(' 12345678 ')).toBe('12345678')
  })

  it('returns empty for null / blank', () => {
    expect(normaliseRegistration(null)).toBe('')
    expect(normaliseRegistration('   ')).toBe('')
  })
})

function entity(over: Partial<BlockableEntity> & { id: string }): BlockableEntity {
  return {
    legalName: 'Acme Steel Ltd',
    registrationNumber: null,
    country: 'GB',
    sector: 'steel',
    ...over,
  }
}

describe('blockingKeys', () => {
  it('emits a strong registration key and a geo key when a reg number exists', () => {
    const keys = blockingKeys(entity({ id: 'e1', registrationNumber: 'SC 123456' }))
    expect(keys).toContain('reg:SC123456')
    expect(keys).toContain('geo:gb|steel')
  })

  it('emits only the geo key when registration is absent', () => {
    const keys = blockingKeys(entity({ id: 'e2', registrationNumber: null }))
    expect(keys).toEqual(['geo:gb|steel'])
  })
})

describe('candidatePairs', () => {
  it('pairs entities that share a registration number', () => {
    const pairs = candidatePairs([
      entity({ id: 'a', registrationNumber: '12345678', country: 'GB', sector: 'steel' }),
      entity({ id: 'b', registrationNumber: '1234-5678', country: 'DE', sector: 'cement' }),
    ])
    expect(pairs).toEqual([['a', 'b']])
  })

  it('pairs entities in the same country+sector block', () => {
    const pairs = candidatePairs([
      entity({ id: 'a' }),
      entity({ id: 'b' }),
    ])
    expect(pairs).toEqual([['a', 'b']])
  })

  it('does not pair across different geo blocks with no shared registration', () => {
    const pairs = candidatePairs([
      entity({ id: 'a', country: 'GB', sector: 'steel' }),
      entity({ id: 'b', country: 'DE', sector: 'cement' }),
    ])
    expect(pairs).toEqual([])
  })

  it('emits each pair once even when two blocking keys are shared', () => {
    const pairs = candidatePairs([
      entity({ id: 'a', registrationNumber: 'X1', country: 'GB', sector: 'steel' }),
      entity({ id: 'b', registrationNumber: 'X1', country: 'GB', sector: 'steel' }),
    ])
    expect(pairs).toEqual([['a', 'b']])
  })

  it('orders each pair deterministically (id-sorted) and is symmetric-free', () => {
    const pairs = candidatePairs([
      entity({ id: 'z' }),
      entity({ id: 'a' }),
      entity({ id: 'm' }),
    ])
    // 3 entities in one block → 3 unordered pairs, each id-sorted.
    expect(pairs).toEqual([
      ['a', 'm'],
      ['a', 'z'],
      ['m', 'z'],
    ])
  })
})
