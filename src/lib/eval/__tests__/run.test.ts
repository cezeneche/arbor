import { runEval } from '../run'
import type { EvalCase, EvalBaseline } from '../types'

// Pre-deploy eval gate — orchestrator. Dependency-injected (loadFixture, extract)
// so the wiring is testable without the live model or the filesystem. The live
// gate spec supplies the real document loader and extractor.

const cases: EvalCase[] = [
  { id: 'bill', documentType: 'ELECTRICITY_BILL', fixture: 'bill.pdf', mediaType: 'application/pdf', expected: [{ fieldName: 'supplier_name', expectedValue: 'Acme' }] },
  { id: 'customs', documentType: 'CUSTOMS_DECLARATION', fixture: 'customs.pdf', mediaType: 'application/pdf', expected: [{ fieldName: 'declared_weight', expectedValue: '10' }] },
]
const baseline: EvalBaseline = { groups: {}, overall: 0 }

describe('runEval', () => {
  it('loads each fixture, extracts, and scores into one report', async () => {
    const extractByCase: Record<string, { fieldName: string; rawValue: string | null }[]> = {
      'bill.pdf': [{ fieldName: 'supplier_name', rawValue: 'Acme' }],
      'customs.pdf': [{ fieldName: 'declared_weight', rawValue: '10' }],
    }
    const report = await runEval('v1', cases, baseline, {
      loadFixture: async (f) => `base64:${f}`,
      extract: async ({ documentBase64 }) => extractByCase[documentBase64.replace('base64:', '')],
    })
    expect(report.caseCount).toBe(2)
    expect(report.fieldCount).toBe(2)
    expect(report.overall).toBe(1)
    expect(report.passed).toBe(true)
  })

  it('passes the case documentType and mediaType through to the extractor', async () => {
    const seen: { documentType: string; mediaType: string }[] = []
    await runEval('v1', cases, baseline, {
      loadFixture: async () => 'b64',
      extract: async ({ documentType, mediaType }) => {
        seen.push({ documentType, mediaType })
        return []
      },
    })
    expect(seen).toEqual([
      { documentType: 'ELECTRICITY_BILL', mediaType: 'application/pdf' },
      { documentType: 'CUSTOMS_DECLARATION', mediaType: 'application/pdf' },
    ])
  })

  it('a wrong extraction on a kill-signal field fails the gate', async () => {
    const report = await runEval('v1', cases, { groups: { mass: 1 }, overall: 1 }, {
      loadFixture: async () => 'b64',
      extract: async ({ documentType }) =>
        documentType === 'CUSTOMS_DECLARATION'
          ? [{ fieldName: 'declared_weight', rawValue: '999' }]
          : [{ fieldName: 'supplier_name', rawValue: 'Acme' }],
    })
    expect(report.passed).toBe(false)
    expect(report.regressions.some(r => r.group === 'mass')).toBe(true)
  })

  it('returns an all-pass report for an empty golden set (nothing to regress)', async () => {
    const report = await runEval('v1', [], baseline, {
      loadFixture: async () => '',
      extract: async () => [],
    })
    expect(report.caseCount).toBe(0)
    expect(report.passed).toBe(true)
  })
})
