// Core 5 — Email-forward inbound request handler. Pure helpers: recipient-token
// parsing, parsing the model's structured output, and matching a parsed request
// against stored records. No DB, no AI, no side effects.

export interface ParsedRequest {
  domain: string | null
  fields: string[]
  periodStart: string | null
  periodEnd: string | null
}

/** Derive the entity token from a requests-<token>@arbor.io recipient address. */
export function extractRequestToken(to: string): string | null {
  const match = to.match(/requests-([a-z0-9]+)@/i)
  return match ? match[1] : null
}

/** Parse the structured JSON the model returns for a request email. */
export function parseRequestResponse(rawText: string): ParsedRequest | null {
  try {
    const p = JSON.parse(rawText) as Record<string, unknown>
    return {
      domain: typeof p.domain === 'string' ? p.domain : null,
      fields: Array.isArray(p.fields) ? p.fields.filter((f): f is string => typeof f === 'string') : [],
      periodStart: typeof p.periodStart === 'string' ? p.periodStart : null,
      periodEnd: typeof p.periodEnd === 'string' ? p.periodEnd : null,
    }
  } catch {
    return null
  }
}

export interface MatchRecord {
  id: string
  domain: string
  fieldName: string
  value: number
  unit: string
  trustTier: 'A' | 'B' | 'C'
  periodStart: string | Date
  periodEnd: string | Date
}

export interface AnswerRecordRef {
  recordId: string
  value: number
  unit: string
  trustTier: 'A' | 'B' | 'C'
}

export interface FieldAnswer {
  fieldName: string
  recordIds: string[]
  records: AnswerRecordRef[]
}

export interface MatchResult {
  covered: boolean
  answers: FieldAnswer[]
  missingFields: string[]
}

function toTime(d: string | Date): number {
  return d instanceof Date ? d.getTime() : Date.parse(d)
}

/**
 * Match a parsed request against stored records. A record belongs to the request
 * when its domain matches and (if a period is given) its period overlaps. The
 * request is "covered" when every requested field has at least one matching
 * record — or, when no specific fields were asked for, when any record matches.
 */
export function matchRequestToRecords(parsed: ParsedRequest, records: MatchRecord[]): MatchResult {
  const reqStart = parsed.periodStart ? Date.parse(parsed.periodStart) : null
  const reqEnd = parsed.periodEnd ? Date.parse(parsed.periodEnd) : null

  const inScope = records.filter((r) => {
    if (parsed.domain && r.domain !== parsed.domain) return false
    // Period overlap, only when a bound was supplied and parses.
    if (reqStart !== null && !isNaN(reqStart) && toTime(r.periodEnd) < reqStart) return false
    if (reqEnd !== null && !isNaN(reqEnd) && toTime(r.periodStart) > reqEnd) return false
    return true
  })

  if (parsed.fields.length === 0) {
    const answers: FieldAnswer[] = groupByField(inScope)
    return { covered: inScope.length > 0, answers, missingFields: [] }
  }

  const answers: FieldAnswer[] = []
  const missingFields: string[] = []
  for (const field of parsed.fields) {
    const matched = inScope.filter((r) => r.fieldName === field)
    if (matched.length === 0) {
      missingFields.push(field)
    } else {
      answers.push(toFieldAnswer(field, matched))
    }
  }

  return { covered: missingFields.length === 0 && answers.length > 0, answers, missingFields }
}

function toFieldAnswer(fieldName: string, records: MatchRecord[]): FieldAnswer {
  return {
    fieldName,
    recordIds: records.map((r) => r.id),
    records: records.map((r) => ({ recordId: r.id, value: r.value, unit: r.unit, trustTier: r.trustTier })),
  }
}

function groupByField(records: MatchRecord[]): FieldAnswer[] {
  const byField = new Map<string, MatchRecord[]>()
  for (const r of records) {
    const list = byField.get(r.fieldName) ?? []
    list.push(r)
    byField.set(r.fieldName, list)
  }
  return [...byField.entries()].map(([fieldName, recs]) => toFieldAnswer(fieldName, recs))
}
