// Questionnaire pre-fill engine.
// Pure function: (template, records) → PrefilledAnswer[]. No DB, no AI, no
// conversion (the Layer-3 loader presents records already in each question's
// target unit). Assembly is a transparent sum of identical-unit records — never
// an emission factor, never a meaning-changing unit conversion.

import type { TrustTier } from '@/lib/constants'
import type {
  QuestionnaireTemplate,
  QuestionDefinition,
  PrefilledAnswer,
  PrefillRecordRef,
} from './types'

export interface PrefillInputRecord {
  id: string
  domain: string
  fieldName: string
  value: number
  unit: string
  trustTier: TrustTier
  periodStart: string | Date
  periodEnd: string | Date
}

// A is best, C is worst. "Worst contributing tier" = the largest rank.
const TIER_RANK: Record<TrustTier, number> = { A: 0, B: 1, C: 2 }

function worstTier(tiers: TrustTier[]): TrustTier | null {
  if (tiers.length === 0) return null
  return tiers.reduce((worst, t) => (TIER_RANK[t] > TIER_RANK[worst] ? t : worst), tiers[0])
}

function toIso(d: string | Date): string {
  return d instanceof Date ? d.toISOString() : d
}

function toRef(r: PrefillInputRecord): PrefillRecordRef {
  return {
    recordId: r.id,
    value: r.value,
    unit: r.unit,
    trustTier: r.trustTier,
    periodStart: toIso(r.periodStart),
    periodEnd: toIso(r.periodEnd),
  }
}

export function prefillQuestionnaire(
  template: QuestionnaireTemplate,
  records: PrefillInputRecord[],
): PrefilledAnswer[] {
  return template.questions.map((q) => answerQuestion(q, records))
}

function answerQuestion(q: QuestionDefinition, records: PrefillInputRecord[]): PrefilledAnswer {
  const base = {
    questionId: q.id,
    questionText: q.text,
    section: q.section,
    mode: q.mode,
  }

  const gap = (): PrefilledAnswer => ({
    ...base,
    status: 'gap',
    value: null,
    unit: q.unit ?? null,
    trustTier: null,
    sourceRecordIds: [],
    contributingCount: 0,
    note: null,
    contributingRecords: [],
  })

  const matching = records.filter((r) => r.domain === q.domain && r.fieldName === q.fieldName)
  if (matching.length === 0) return gap()

  if (q.mode === 'collection') {
    return {
      ...base,
      status: 'answered',
      value: null,
      unit: null,
      trustTier: worstTier(matching.map((r) => r.trustTier)),
      sourceRecordIds: matching.map((r) => r.id),
      contributingCount: matching.length,
      note: `${matching.length} record${matching.length === 1 ? '' : 's'} to combine in your tool`,
      contributingRecords: matching.map(toRef),
    }
  }

  // direct / assemble — only ever operate on a single, identical unit.
  const targetUnit = q.unit ?? matching[0].unit
  const unitMatched = matching.filter((r) => r.unit === targetUnit)
  if (unitMatched.length === 0) return gap()

  if (q.mode === 'direct') {
    // The canonical record is the most recent one by period end.
    const chosen = unitMatched.reduce(
      (latest, r) => (toIso(r.periodEnd) > toIso(latest.periodEnd) ? r : latest),
      unitMatched[0],
    )
    return {
      ...base,
      status: 'answered',
      value: chosen.value,
      unit: chosen.unit,
      trustTier: chosen.trustTier,
      sourceRecordIds: [chosen.id],
      contributingCount: 1,
      note: unitMatched.length > 1 ? `most recent of ${unitMatched.length} records` : null,
      contributingRecords: [toRef(chosen)],
    }
  }

  // assemble — transparent sum of identical-unit records.
  const sum = unitMatched.reduce((acc, r) => acc + r.value, 0)
  return {
    ...base,
    status: 'answered',
    value: sum,
    unit: targetUnit,
    trustTier: worstTier(unitMatched.map((r) => r.trustTier)),
    sourceRecordIds: unitMatched.map((r) => r.id),
    contributingCount: unitMatched.length,
    note: `Σ of ${unitMatched.length} record${unitMatched.length === 1 ? '' : 's'}`,
    contributingRecords: unitMatched.map(toRef),
  }
}
