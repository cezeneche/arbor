// Layer 1 — runtime shape checking for what the model sends back. Pure: no DB,
// no network, no side effects.
//
// The response was parsed as JSON and then cast to the expected type. A cast is
// a claim, not a check: a field arriving with confidenceScore: "high", a null
// fieldName, or flagged: "yes" went straight into the extraction job and from
// there into confidence maths and the review screen. Layer 1 is the boundary
// between a probabilistic system and a certified one, so it is the place that has
// to insist on shape.
import { z } from 'zod'
import type { ExtractedFieldResult } from './types'

const nullableString = z.union([z.string(), z.null()]).optional()

/** Deliberately permissive about what it accepts and strict about what it emits:
 *  the model is a third party, so a field it half-fills is coerced to the
 *  conservative reading (absent value, zero confidence, flagged) rather than
 *  thrown away or trusted. */
const fieldSchema = z
  .object({
    fieldName: z.string().min(1),
    rawValue: nullableString,
    rawUnit: nullableString,
    sourceText: nullableString,
    confidenceScore: z.union([z.number(), z.string(), z.null()]).optional(),
    flagged: z.union([z.boolean(), z.string(), z.null()]).optional(),
    flagReason: nullableString,
  })
  .passthrough()

export const extractionResponseSchema = z
  .object({
    documentTypeConfirmed: z.string().optional(),
    extractionNotes: z.string().optional(),
    fields: z.array(z.unknown()).optional(),
  })
  .passthrough()

/** Confidence must be a number in [0,1]. Anything else is not a confidence, and
 *  treating it as one would let an unreadable field present as certain — the
 *  0.85 review threshold is the entire basis of Tier A. */
function toConfidence(raw: unknown): { value: number; readable: boolean } {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN
  if (!Number.isFinite(n)) return { value: 0, readable: false }
  return { value: Math.min(1, Math.max(0, n)), readable: true }
}

function toFlag(raw: unknown): boolean {
  if (typeof raw === 'boolean') return raw
  if (typeof raw === 'string') return raw.trim().toLowerCase() === 'true'
  return false
}

export interface NormalisedExtractionResponse {
  documentTypeConfirmed: string | null
  extractionNotes: string
  fields: ExtractedFieldResult[]
  /** Entries the model returned that could not be read as a field at all. */
  discardedFieldCount: number
}

/**
 * Reads a parsed model response into the shape the rest of the pipeline relies
 * on. Returns null when the response is not an object with a readable structure —
 * the caller treats that as a failed extraction rather than an empty one, because
 * "we read nothing" and "there was nothing to read" are different facts.
 */
export function normaliseExtractionResponse(parsed: unknown): NormalisedExtractionResponse | null {
  const envelope = extractionResponseSchema.safeParse(parsed)
  if (!envelope.success) return null

  const fields: ExtractedFieldResult[] = []
  let discardedFieldCount = 0

  for (const raw of envelope.data.fields ?? []) {
    const field = fieldSchema.safeParse(raw)
    if (!field.success) {
      discardedFieldCount++
      continue
    }
    const f = field.data
    const confidence = toConfidence(f.confidenceScore)
    fields.push({
      fieldName: f.fieldName,
      rawValue: f.rawValue ?? null,
      rawUnit: f.rawUnit ?? null,
      sourceText: f.sourceText ?? '',
      confidenceScore: confidence.value,
      // A field whose confidence could not be read is flagged, not silently
      // accepted at zero: the reviewer must see it.
      flagged: toFlag(f.flagged) || !confidence.readable,
      flagReason:
        f.flagReason ??
        (confidence.readable
          ? null
          : 'The extractor did not report how confident it was in this value.'),
    })
  }

  return {
    documentTypeConfirmed: envelope.data.documentTypeConfirmed ?? null,
    extractionNotes: envelope.data.extractionNotes ?? '',
    fields,
    discardedFieldCount,
  }
}

/** Reads an integer environment setting, falling back when it is absent,
 *  unparseable, or out of range. `Number('auto')` is NaN, and NaN survived
 *  Math.max to become the sample count, which silently broke sampling. */
export function readPositiveIntEnv(raw: string | undefined, fallback: number, max = 100): number {
  if (raw === undefined || raw.trim() === '') return fallback
  const n = Number(raw)
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) return fallback
  return Math.min(n, max)
}
