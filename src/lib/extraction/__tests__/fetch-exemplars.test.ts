import { fetchCorrectionExemplars, exemplarsEnabled } from '../fetch-exemplars'

// Relearning extractor — exemplar fetch (the DB-reading part, kept OUT of the
// pure engine so Layer 1's AI path stays DB-free). Within-tenant only, fail-soft:
// relearning must never block or degrade extraction.

function fakePrisma(rows: { fieldName: string; extractedValue: string | null; confirmedValue: string | null }[]) {
  const calls: { where: Record<string, unknown> }[] = []
  return {
    calls,
    prisma: {
      groundTruthLabel: {
        findMany: async (args: { where: Record<string, unknown> }) => {
          calls.push({ where: args.where })
          return rows
        },
      },
    },
  }
}

describe('fetchCorrectionExemplars', () => {
  it('queries only the entity’s own REVIEW_CORRECTED labels for the document class (tenant isolation)', async () => {
    const fake = fakePrisma([
      { fieldName: 'declared_weight', extractedValue: '1000', confirmedValue: '100' },
      { fieldName: 'declared_weight', extractedValue: '50', confirmedValue: '5' },
    ])
    const hints = await fetchCorrectionExemplars('ent_1', 'CUSTOMS_DECLARATION', { prisma: fake.prisma })
    expect(fake.calls[0].where).toMatchObject({
      entityId: 'ent_1',
      documentClass: 'CUSTOMS_DECLARATION',
      source: 'REVIEW_CORRECTED',
    })
    expect(hints[0]).toMatchObject({ fieldName: 'declared_weight', timesCorrected: 2 })
  })

  it('fails soft to no hints if the read throws (never blocks extraction)', async () => {
    const throwing = {
      groundTruthLabel: { findMany: async () => { throw new Error('db down') } },
    }
    await expect(fetchCorrectionExemplars('ent_1', 'X', { prisma: throwing })).resolves.toEqual([])
  })

  it('returns no hints when the tenant has no corrections yet', async () => {
    const fake = fakePrisma([])
    expect(await fetchCorrectionExemplars('ent_1', 'X', { prisma: fake.prisma })).toEqual([])
  })
})

describe('exemplarsEnabled', () => {
  const prev = process.env.EXTRACTION_EXEMPLARS
  afterEach(() => {
    if (prev === undefined) delete process.env.EXTRACTION_EXEMPLARS
    else process.env.EXTRACTION_EXEMPLARS = prev
  })

  it('is off unless EXTRACTION_EXEMPLARS=1 (default-off, opt-in behaviour change)', () => {
    delete process.env.EXTRACTION_EXEMPLARS
    expect(exemplarsEnabled()).toBe(false)
    process.env.EXTRACTION_EXEMPLARS = '0'
    expect(exemplarsEnabled()).toBe(false)
    process.env.EXTRACTION_EXEMPLARS = '1'
    expect(exemplarsEnabled()).toBe(true)
  })
})
