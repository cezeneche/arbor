// Pre-deploy eval gate — orchestrator. Runs each golden case through the
// extractor and scores it against the committed baseline. Dependency-injected
// (loadFixture, extract) so the orchestration is unit-testable without the live
// model or the filesystem; the live gate spec wires the real implementations.
//
// Cases run sequentially — a golden set is small, and serial runs avoid hammering
// the model API and keep the report order stable.

import { buildEvalReport } from './evaluate'
import type { EvalCase, EvalBaseline, EvalReport } from './types'

export interface ExtractedLite {
  fieldName: string
  rawValue: string | null
}

export interface EvalDeps {
  /** Load a golden case's document as base64. */
  loadFixture: (fixture: string) => Promise<string>
  /** Run the real extractor and return field name/value pairs. */
  extract: (input: {
    documentBase64: string
    mediaType: EvalCase['mediaType']
    documentType: string
  }) => Promise<ExtractedLite[]>
}

export async function runEval(
  extractorVersion: string,
  cases: EvalCase[],
  baseline: EvalBaseline,
  deps: EvalDeps,
): Promise<EvalReport> {
  const extractedByCase: Record<string, ExtractedLite[]> = {}
  for (const c of cases) {
    const documentBase64 = await deps.loadFixture(c.fixture)
    extractedByCase[c.id] = await deps.extract({
      documentBase64,
      mediaType: c.mediaType,
      documentType: c.documentType,
    })
  }
  return buildEvalReport(extractorVersion, cases, extractedByCase, baseline)
}
