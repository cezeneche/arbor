// Query assistant — turns the records Layer 3 retrieved into a plain English
// answer. Uses AI for language only. Does not read from or write to the
// database, and is handed the records rather than fetching them, so it sits in
// front of Layer 3 exactly as the parser does.
//
// Two rules are enforced in the prompt and in the shape of the evidence:
//
//  1. Nothing may be said that is not in the evidence block. The assistant reads
//     back the store; it does not know anything else about the company.
//  2. Nothing may be calculated. Totals, intensities, conversions and averages
//     are the recipient's job, not arbor's (PRD §15.3, §21.3). The assistant
//     says which records answer the question and hands them over.
//
// Every evidence line carries its certification, so provenance cannot be
// stripped on the way to the answer (PRD §20.2).

import Anthropic from '@anthropic-ai/sdk'

// Chosen by measurement, not by reflex.
//
// Haiku 4.5 holds the hard constraints — across the calculate, convert and
// combine probes it refused every time, and never invented a figure. What it
// does not hold is precision about the evidence: asked what energy records
// exist, it called four records energy when one of them was logistics, in two
// runs out of three. Sonnet 5 was exact in three of three. An assistant whose
// entire job is reading records back accurately cannot miscount them, so the
// answer step runs on Sonnet.
//
// The parser (nl-parser.ts) stays on Haiku: extracting query parameters from a
// short question against a supplied field list is well within it, and it was
// correct on every probe.
export const ANSWER_MODEL = 'claude-sonnet-5'

const DEFAULT_EVIDENCE_LIMIT = 60

export interface AnswerRecord {
  entityName: string
  domain: string
  fieldName: string
  value: number
  unit: string
  periodStart: string | Date
  periodEnd: string | Date
  trustTier: 'A' | 'B' | 'C'
  sourceText?: string | null
}

export interface AnswerGapResult {
  ownMissingDomains: string[]
  supplierGaps: Array<{ supplierName: string; missingDomains: string[] }>
}

const TIER_LABELS: Record<'A' | 'B' | 'C', string> = {
  A: 'Verified',
  B: 'Declared',
  C: 'Estimated',
}

function isoDate(value: string | Date): string {
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? String(value) : d.toISOString().slice(0, 10)
}

/**
 * The complete, and only, factual basis for the answer. One line per record:
 * who it belongs to, what it is, what it says, when it covers, and how it is
 * certified.
 */
export function buildEvidenceBlock(
  records: AnswerRecord[],
  opts: { limit?: number } = {},
): string {
  if (records.length === 0) {
    return 'No records in the store match this question.'
  }

  const limit = opts.limit ?? DEFAULT_EVIDENCE_LIMIT
  const shown = records.slice(0, limit)
  const omitted = records.length - shown.length

  const lines = shown.map(r =>
    [
      r.entityName,
      r.domain,
      r.fieldName,
      `${r.value} ${r.unit}`,
      `${isoDate(r.periodStart)} to ${isoDate(r.periodEnd)}`,
      TIER_LABELS[r.trustTier],
    ].join(' | '),
  )

  if (omitted > 0) {
    lines.push(
      `(${omitted} further record${omitted === 1 ? '' : 's'} matched but are not listed here.)`,
    )
  }

  return lines.join('\n')
}

export function buildGapBlock(gap: AnswerGapResult): string {
  const parts: string[] = []
  if (gap.ownMissingDomains.length > 0) {
    parts.push(`This company has no records for: ${gap.ownMissingDomains.join(', ')}.`)
  }
  for (const s of gap.supplierGaps) {
    parts.push(`${s.supplierName} has no records for: ${s.missingDomains.join(', ')}.`)
  }
  return parts.length > 0 ? parts.join('\n') : 'No gaps: every expected area has records.'
}

export function buildAnswerSystemPrompt(opts: { plainEnglish: boolean }): string {
  const shared = `You are the query assistant for arbor, a certified operational data repository. A user has asked a question about the operational data their company has stored. The matching records have already been retrieved for you and appear as evidence.

Answer the question in two to four sentences.

HARD RULES — these are not style preferences:
- Use only the records below as evidence. If the evidence does not answer the question, say so and say what document the user would need to upload to answer it. Never state a figure, period, company or unit that is not in the evidence.
- Do not calculate, add, sum, average, total, or otherwise derive any new number. arbor stores operational data; it does not compute. If the question asks for a total, an intensity, an average, a percentage or a footprint, say plainly that arbor does not calculate that, and point at the records the user (or their reporting tool) needs to do it themselves.
- Do not convert between units, and never combine two different units into one figure. Report each figure in the unit it is stored in.
- Never present a figure without its certification. Every figure you quote must say whether it is Verified, Declared or Estimated.
- Do not speculate about what the data means for compliance, emissions performance, or any regulation.

Write in British English. No bullet points, no headings, no markdown — just sentences.`

  if (opts.plainEnglish) {
    return `${shared}

This user runs a small business and has no sustainability or data background. Write in plain English. Never use the words tier, domain, aggregation, or any field code — say "electricity used", not "total_consumption_kwh". Verified, Declared and Estimated are the only status words you may use.`
  }

  return `${shared}

This user is a professional data buyer. Full technical detail is expected: field names, trust tier labels (Verified / Declared / Estimated), periods, and the entity each record belongs to.`
}

/**
 * The answer when the model is unavailable. The records are the product, so the
 * page degrades to a plain factual sentence above the table — never an error.
 */
export function answerWithoutModel(params: {
  recordCount: number
  interpretation: string
}): string {
  const { recordCount, interpretation } = params
  if (recordCount === 0) {
    return `No stored records match ${interpretation}. Upload a supporting document, or enter the figure directly, and it will be answerable from then on.`
  }
  return `${recordCount} stored record${recordCount === 1 ? '' : 's'} match ${interpretation}. They are listed below with the certification of each.`
}

let client: Anthropic | null = null
function getClient(): Anthropic {
  if (!client) client = new Anthropic()
  return client
}

export interface ComposeAnswerParams {
  question: string
  interpretation: string
  records: AnswerRecord[]
  gapResult?: AnswerGapResult | null
  /** True for SME suppliers: plain English only, no codes. */
  plainEnglish: boolean
}

/**
 * Compose the spoken answer. Never throws — on any model failure the caller
 * still gets a truthful sentence and the record table underneath it.
 */
export async function composeAnswer(params: ComposeAnswerParams): Promise<string> {
  const { question, interpretation, records, gapResult, plainEnglish } = params

  const evidence = gapResult ? buildGapBlock(gapResult) : buildEvidenceBlock(records)

  // Prepared up front so both the empty-response and the failure path use it.
  const fallback = gapResult
    ? buildGapBlock(gapResult)
    : answerWithoutModel({ recordCount: records.length, interpretation })

  const userContent = `Question: ${question}

What was searched for: ${interpretation}

Evidence (entity | area | field | value | period | certification):
${evidence}`

  try {
    const response = await getClient().messages.create({
      model: ANSWER_MODEL,
      max_tokens: 700,
      // Thinking stays on at low effort: cheaper and faster than a large budget,
      // and disabling it on this model risks internal tags leaking into the text
      // the user reads.
      thinking: { type: 'adaptive' },
      output_config: { effort: 'low' },
      system: buildAnswerSystemPrompt({ plainEnglish }),
      messages: [{ role: 'user', content: userContent }],
    })

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('')
      .trim()

    return text || fallback
  } catch {
    return fallback
  }
}
