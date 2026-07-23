// Pre-deploy eval gate — LIVE runner. This is the only piece that calls the real
// model, so it is deliberately kept OUT of the default `npm test` suite (its
// `.eval.ts` name is not matched by the base jest testMatch). It runs on demand:
//
//   npm run eval               # gate: fails (non-zero exit) if a kill-signal group regressed
//   npm run eval:baseline      # snapshot the current run as the new committed baseline
//
// Run it before bumping EXTRACTION_MODEL or PROMPT_VERSION. Requires
// ANTHROPIC_API_KEY. With an empty golden set it is a no-op that passes — add
// fixtures + expected values to eval/golden-set.json to arm the gate.

import fs from 'fs'
import path from 'path'
import { runEval } from '@/lib/eval/run'
import { parseGoldenSet, parseBaseline, EMPTY_BASELINE } from '@/lib/eval/golden-set'
import { toBaseline } from '@/lib/eval/evaluate'
import { extractDocument } from '@/lib/extraction/engine'
import { EXTRACTOR_VERSION } from '@/lib/extraction/extractor-version'

const EVAL_DIR = path.join(process.cwd(), 'eval')
const FIXTURES_DIR = path.join(EVAL_DIR, 'fixtures')

function readJson(file: string): unknown | null {
  const p = path.join(EVAL_DIR, file)
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null
}

describe('pre-deploy extraction eval gate', () => {
  const goldenJson = readJson('golden-set.json')
  const cases = goldenJson ? parseGoldenSet(goldenJson) : []
  const baselineJson = readJson('baseline.json')
  const baseline = baselineJson ? parseBaseline(baselineJson) : EMPTY_BASELINE

  it(
    'extraction accuracy has not regressed on the golden set',
    async () => {
      if (cases.length === 0) {
        console.warn('[eval] no golden cases in eval/golden-set.json — add fixtures to arm the gate')
        return
      }

      const report = await runEval(EXTRACTOR_VERSION, cases, baseline, {
        loadFixture: async (fixture) =>
          fs.readFileSync(path.join(FIXTURES_DIR, fixture)).toString('base64'),
        extract: async ({ documentBase64, mediaType, documentType }) => {
          const result = await extractDocument({
            documentBase64,
            mediaType,
            documentType,
            entityName: 'EVAL',
          })
          return result.fields.map((f) => ({ fieldName: f.fieldName, rawValue: f.rawValue }))
        },
      })

      console.log(
        '[eval] report\n' +
          JSON.stringify(
            { extractorVersion: report.extractorVersion, overall: report.overall, groups: report.groups, regressions: report.regressions },
            null,
            2,
          ),
      )

      if (process.env.EVAL_UPDATE_BASELINE === '1') {
        fs.writeFileSync(
          path.join(EVAL_DIR, 'baseline.json'),
          JSON.stringify(toBaseline(report), null, 2) + '\n',
        )
        console.log('[eval] baseline updated from this run')
        return
      }

      // The gate: any kill-signal regression fails the run (non-zero exit).
      expect(report.regressions).toEqual([])
    },
    300_000,
  )
})
