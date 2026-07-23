// Pre-deploy eval gate — golden-set / baseline loading and validation. Pure.
//
// The golden set (eval/golden-set.json) and the committed baseline
// (eval/baseline.json) are hand-curated JSON. Validate them at load so a typo in
// a case fails loudly before the live model is ever called.

import { z } from 'zod'
import type { EvalCase, EvalBaseline } from './types'

const expectedFieldSchema = z.object({
  fieldName: z.string().min(1),
  expectedValue: z.string().nullable(),
})

const caseSchema = z.object({
  id: z.string().min(1),
  documentType: z.string().min(1),
  fixture: z.string().min(1),
  mediaType: z.enum(['application/pdf', 'image/jpeg', 'image/png']),
  expected: z.array(expectedFieldSchema),
})

const goldenSetSchema = z
  .object({ cases: z.array(caseSchema) })
  .superRefine((val, ctx) => {
    const seen = new Set<string>()
    for (const c of val.cases) {
      if (seen.has(c.id)) {
        ctx.addIssue({ code: 'custom', message: `duplicate case id: ${c.id}` })
      }
      seen.add(c.id)
    }
  })

const baselineSchema = z.object({
  extractorVersion: z.string().optional(),
  groups: z.record(z.string(), z.number()),
  overall: z.number(),
})

export function parseGoldenSet(json: unknown): EvalCase[] {
  return goldenSetSchema.parse(json).cases
}

export function parseBaseline(json: unknown): EvalBaseline {
  return baselineSchema.parse(json)
}

/** Baseline used when eval/baseline.json is absent — nothing to compare against,
 *  so only the absolute kill-signal floor applies. */
export const EMPTY_BASELINE: EvalBaseline = { groups: {}, overall: 0 }
