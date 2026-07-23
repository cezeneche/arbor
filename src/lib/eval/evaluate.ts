// Pre-deploy eval gate — pure scoring core. No DB, no AI, no disk.
//
// Given a re-run extraction and the human-verified expected values for each
// golden case, this decides whether extraction accuracy regressed. It reuses the
// calibration loop's building blocks so the gate is consistent with the live
// monitor: valuesMatch for correctness (cosmetic diffs are not misses),
// classifyFieldType for grouping, and KILL_SIGNAL_GROUPS for what actually gates.
//
// Philosophy (from the plan): only the three kill-signal field groups gate a
// deploy. Everything else is measured and reported but a dip there does not hold
// a release — those buckets are noisier and not the trust-critical surface.

import { valuesMatch } from '@/lib/confidence/ground-truth'
import { classifyFieldType, type FieldType } from '@/lib/brain/field-types'
import { KILL_SIGNAL_GROUPS } from '@/lib/confidence/calibration-metrics'
import type {
  EvalCase,
  FieldScore,
  GroupAccuracy,
  EvalBaseline,
  Regression,
  EvalReport,
} from './types'

/** A kill-signal group may fall at most this far below baseline before it gates. */
export const KILL_SIGNAL_MAX_DROP = 0.05

/** Absolute floor for a kill-signal group, applied even with no baseline entry. */
export const KILL_SIGNAL_MIN_ACCURACY = 0.8

const KILL_SIGNAL_SET: ReadonlySet<string> = new Set(KILL_SIGNAL_GROUPS)

/** The group a field is scored under: its kill-signal bucket, or its raw name. */
export function groupOf(fieldName: string): string {
  return classifyFieldType(fieldName) ?? fieldName
}

function isKillSignal(group: string): boolean {
  return KILL_SIGNAL_SET.has(group as FieldType)
}

/** Score every expected field in a case against what the extractor returned. */
export function scoreCase(
  c: EvalCase,
  extracted: { fieldName: string; rawValue: string | null }[],
): FieldScore[] {
  const actualByName = new Map(extracted.map(f => [f.fieldName, f.rawValue ?? null]))
  return c.expected.map(exp => {
    const actual = actualByName.get(exp.fieldName) ?? null
    const group = groupOf(exp.fieldName)
    return {
      caseId: c.id,
      fieldName: exp.fieldName,
      group,
      expected: exp.expectedValue,
      actual,
      correct: valuesMatch(actual, exp.expectedValue),
    }
  })
}

/** Collapse per-field scores into per-group accuracy, sorted by group name. */
export function aggregateByGroup(scores: FieldScore[]): GroupAccuracy[] {
  const byGroup = new Map<string, { total: number; correct: number }>()
  for (const s of scores) {
    const g = byGroup.get(s.group) ?? { total: 0, correct: 0 }
    g.total += 1
    if (s.correct) g.correct += 1
    byGroup.set(s.group, g)
  }
  return [...byGroup.entries()]
    .map(([group, { total, correct }]) => ({
      group,
      total,
      correct,
      accuracy: total === 0 ? 0 : correct / total,
      isKillSignalGroup: isKillSignal(group),
    }))
    .sort((a, b) => a.group.localeCompare(b.group))
}

/** Which kill-signal groups regressed versus the committed baseline, or fell
 *  below the absolute floor. Non-kill-signal groups never gate. */
export function compareToBaseline(groups: GroupAccuracy[], baseline: EvalBaseline): Regression[] {
  const regressions: Regression[] = []
  for (const g of groups) {
    if (!g.isKillSignalGroup) continue

    // Absolute floor first — a kill-signal group below the floor gates whatever
    // the baseline says (covers first runs with no baseline entry).
    if (g.accuracy < KILL_SIGNAL_MIN_ACCURACY) {
      const base = baseline.groups[g.group]
      regressions.push({
        group: g.group,
        baseline: base ?? null,
        current: g.accuracy,
        drop: base !== undefined ? base - g.accuracy : 0,
        isKillSignalGroup: true,
        reason: 'below-floor',
      })
      continue
    }

    // Relative regression versus baseline.
    const base = baseline.groups[g.group]
    if (base !== undefined && base - g.accuracy > KILL_SIGNAL_MAX_DROP) {
      regressions.push({
        group: g.group,
        baseline: base,
        current: g.accuracy,
        drop: base - g.accuracy,
        isKillSignalGroup: true,
        reason: 'kill-signal-regression',
      })
    }
  }
  return regressions
}

/** Assemble the gated report from cases, their extractions, and the baseline. */
export function buildEvalReport(
  extractorVersion: string,
  cases: EvalCase[],
  extractedByCase: Record<string, { fieldName: string; rawValue: string | null }[]>,
  baseline: EvalBaseline,
): EvalReport {
  const scores = cases.flatMap(c => scoreCase(c, extractedByCase[c.id] ?? []))
  const groups = aggregateByGroup(scores)
  const correct = scores.filter(s => s.correct).length
  const regressions = compareToBaseline(groups, baseline)
  return {
    extractorVersion,
    caseCount: cases.length,
    fieldCount: scores.length,
    overall: scores.length === 0 ? 0 : correct / scores.length,
    groups,
    regressions,
    passed: regressions.length === 0,
  }
}

/** Snapshot the current run's per-group accuracy as a new committed baseline. */
export function toBaseline(report: EvalReport): EvalBaseline {
  const groups: Record<string, number> = {}
  for (const g of report.groups) groups[g.group] = g.accuracy
  return { extractorVersion: report.extractorVersion, groups, overall: report.overall }
}
