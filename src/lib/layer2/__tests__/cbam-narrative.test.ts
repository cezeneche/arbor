/* eslint-disable @typescript-eslint/no-explicit-any -- test doubles stand in for Prisma's generic argument types */
import { narrativeReviewEmail, writeNarrative, type NarrativeDeps } from '../cbam-narrative'
import { NarrativeBlockedError, NarrativeNotAllowedError } from '@/lib/nucleos/narrative-client'
import { NucleosUnavailableError } from '@/lib/nucleos/extraction-client'

// An audit narrative is kept as Nucleos wrote it, with its review verdict.
// When a person must review it, the organisation is emailed — and a failed
// email never loses the narrative.

const narrative = { executive_summary: 's', methodology: 'm', limitations: 'l', open_gaps: [], results: {} }

function deps(review = { required: false, reasons: [] as string[] }) {
  const rows = new Map<string, any>()
  const sent: any[] = []
  const d: NarrativeDeps = {
    db: {
      cbamNarrative: {
        create: jest.fn(async ({ data }: any) => {
          const row = { id: 'nar-1', emailedAt: null, ...data }
          rows.set(row.id, row)
          return row
        }),
        update: jest.fn(async ({ where, data }: any) => {
          const row = { ...rows.get(where.id), ...data }
          rows.set(where.id, row)
          return row
        }),
      },
    } as any,
    run: jest.fn(async () => ({ narrative, review, packHash: 'h'.repeat(64) })),
    recipients: jest.fn(async () => ['ada@acme.test', 'bo@acme.test']),
    send: jest.fn(async (m: any) => {
      sent.push(m)
    }),
    appUrl: 'https://arbor.test',
    now: () => new Date('2027-05-01T09:00:00Z'),
  }
  return { d, rows, sent }
}

const input = { entityId: 'ent-1', userId: 'user-1', caseId: 'case-1', caseLabel: 'GB123456789000 · 2027 Q1' }

describe('writeNarrative', () => {
  it('keeps the narrative with who asked for it, and emails no one when it is clean', async () => {
    const { d, rows, sent } = deps()
    await expect(writeNarrative(input, d)).resolves.toEqual({
      ok: true,
      narrativeId: 'nar-1',
      reviewRequired: false,
      emailed: 0,
      emailProblem: null,
    })
    expect(rows.get('nar-1')).toMatchObject({
      entityId: 'ent-1',
      nucleosCaseId: 'case-1',
      generatedById: 'user-1',
      reviewRequired: false,
      reviewReasons: [],
      narrative,
      packHash: 'h'.repeat(64),
    })
    expect(sent).toEqual([])
  })

  it("emails each of the organisation's writers when review is needed, and records it", async () => {
    const { d, rows, sent } = deps({ required: true, reasons: ['Direct emissions do not match.'] })
    const out = await writeNarrative(input, d)
    expect(out).toMatchObject({ ok: true, reviewRequired: true, emailed: 2, emailProblem: null })
    expect(d.recipients).toHaveBeenCalledWith('ent-1')
    expect(sent.map(m => m.to)).toEqual(['ada@acme.test', 'bo@acme.test'])
    expect(sent[0].text).toContain('Direct emissions do not match.')
    expect(rows.get('nar-1').emailedAt).toEqual(new Date('2027-05-01T09:00:00Z'))
  })

  it('keeps the narrative when the email cannot be sent, and says so', async () => {
    const { d, rows } = deps({ required: true, reasons: ['x'] })
    ;(d.send as jest.Mock).mockRejectedValue(new Error('RESEND_API_KEY is not set'))
    const out = await writeNarrative(input, d)
    expect(out).toMatchObject({
      ok: true,
      emailed: 0,
      emailProblem: expect.stringContaining('could not be emailed'),
    })
    expect(rows.get('nar-1').emailedAt).toBeNull()
  })

  it('says the organisation has no one to email, rather than failing', async () => {
    const { d } = deps({ required: true, reasons: ['x'] })
    ;(d.recipients as jest.Mock).mockResolvedValue([])
    await expect(writeNarrative(input, d)).resolves.toMatchObject({
      ok: true,
      emailed: 0,
      emailProblem: expect.any(String),
    })
  })

  it('stores nothing when Nucleos refuses or fails', async () => {
    for (const [err, code] of [
      [new NarrativeNotAllowedError(), 'NOT_ALLOWED'],
      [new NarrativeBlockedError(['direct_embedded_kgco2e']), 'BLOCKED'],
      [new NucleosUnavailableError('down'), 'UNAVAILABLE'],
    ] as const) {
      const { d } = deps()
      ;(d.run as jest.Mock).mockRejectedValue(err)
      const out = await writeNarrative(input, d)
      expect(out).toMatchObject({ ok: false, code })
      expect(d.db.cbamNarrative.create).not.toHaveBeenCalled()
    }
  })

  it('names the gaps when the case is blocked', async () => {
    const { d } = deps()
    ;(d.run as jest.Mock).mockRejectedValue(new NarrativeBlockedError(['direct_embedded_kgco2e']))
    const out = await writeNarrative(input, d)
    expect(out).toMatchObject({
      ok: false,
      code: 'BLOCKED',
      message: expect.stringContaining('direct_embedded_kgco2e'),
    })
  })
})

describe('narrativeReviewEmail', () => {
  it('names the case, lists the reasons and links to it, escaping what it shows', () => {
    const m = narrativeReviewEmail({
      caseLabel: 'GB1 · 2027 Q1',
      reasons: ['Totals <do not> match.'],
      link: 'https://arbor.test/cbam/case-1',
    })
    expect(m.subject).toBe('A CBAM audit narrative needs review: GB1 · 2027 Q1')
    expect(m.text).toContain('Totals <do not> match.')
    expect(m.text).toContain('https://arbor.test/cbam/case-1')
    expect(m.html).toContain('Totals &lt;do not&gt; match.')
    expect(m.html).not.toContain('<do not>')
  })
})
