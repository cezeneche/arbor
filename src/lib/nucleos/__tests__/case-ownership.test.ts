import { resolveCaseAccess, ownedCaseIds, goodsLineBelongsToCase } from '../case-ownership'

// Every Arbor organisation reaches Nucleos with the same service token, so
// Nucleos cannot tell them apart. Arbor's link rows are the only record of which
// organisation a case belongs to, and they are what every case read and write
// is checked against. A case with no link has no provable owner, and is refused.

type Link = { entityId: string; documentId: string; nucleosCaseId: string | null }

function fakeDb(links: Link[]) {
  return {
    cbamCaseLink: {
      findFirst: jest.fn(async ({ where }: { where: { nucleosCaseId: string; entityId: string } }) => {
        const hit = links.find(
          l => l.nucleosCaseId === where.nucleosCaseId && l.entityId === where.entityId,
        )
        return hit ? { documentId: hit.documentId } : null
      }),
      findMany: jest.fn(async ({ where }: { where: { entityId: string } }) =>
        links
          .filter(l => l.entityId === where.entityId && l.nucleosCaseId !== null)
          .map(l => ({ nucleosCaseId: l.nucleosCaseId })),
      ),
    },
  }
}

const LINKS: Link[] = [
  { entityId: 'entity-A', documentId: 'doc-A', nucleosCaseId: 'case-A' },
  { entityId: 'entity-B', documentId: 'doc-B', nucleosCaseId: 'case-B' },
  { entityId: 'entity-A', documentId: 'doc-failed', nucleosCaseId: null },
]

describe('resolveCaseAccess', () => {
  it("allows an organisation its own linked case, and names the document behind it", async () => {
    const access = await resolveCaseAccess('case-A', 'entity-A', fakeDb(LINKS))
    expect(access).toEqual({ allowed: true, documentId: 'doc-A' })
  })

  it("refuses another organisation's case", async () => {
    // The audit reproduction: session A asking for B's case must not reach Nucleos.
    const access = await resolveCaseAccess('case-B', 'entity-A', fakeDb(LINKS))
    expect(access).toEqual({ allowed: false })
  })

  it('refuses a case with no link at all, because nothing proves who owns it', async () => {
    const access = await resolveCaseAccess('legacy-case', 'entity-A', fakeDb(LINKS))
    expect(access).toEqual({ allowed: false })
  })

  it('refuses an empty or missing case id without querying', async () => {
    const db = fakeDb(LINKS)
    expect(await resolveCaseAccess('', 'entity-A', db)).toEqual({ allowed: false })
    expect(await resolveCaseAccess('case-A', '', db)).toEqual({ allowed: false })
    expect(db.cbamCaseLink.findFirst).not.toHaveBeenCalled()
  })

  it('scopes the lookup by both case and organisation in the query itself', async () => {
    const db = fakeDb(LINKS)
    await resolveCaseAccess('case-A', 'entity-A', db)
    expect(db.cbamCaseLink.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { nucleosCaseId: 'case-A', entityId: 'entity-A' } }),
    )
  })
})

describe('ownedCaseIds', () => {
  it("lists only the organisation's own cases, skipping failed handoffs that opened none", async () => {
    expect(await ownedCaseIds('entity-A', fakeDb(LINKS))).toEqual(['case-A'])
    expect(await ownedCaseIds('entity-B', fakeDb(LINKS))).toEqual(['case-B'])
  })

  it('lists nothing for an organisation with no cases', async () => {
    expect(await ownedCaseIds('entity-C', fakeDb(LINKS))).toEqual([])
  })
})

describe('goodsLineBelongsToCase', () => {
  const record = { id: 'case-A', goods_lines: [{ id: 'line-1' }, { id: 'line-2' }] }

  it('accepts a goods line that is on the case', () => {
    expect(goodsLineBelongsToCase(record, 'line-2')).toBe(true)
  })

  it("rejects a goods line from somewhere else — another organisation's, typically", () => {
    expect(goodsLineBelongsToCase(record, 'line-B')).toBe(false)
  })

  it('rejects when the case carries no goods lines, or the id is empty', () => {
    expect(goodsLineBelongsToCase({ id: 'case-A' }, 'line-1')).toBe(false)
    expect(goodsLineBelongsToCase(record, '')).toBe(false)
  })
})
