// Layer 3 — Access. Pure, read-only. The "needs you now" band on the Overview.
//
// Every item here is something the ops manager can act on from this screen
// today, worded as a sentence rather than a statistic. Anything they cannot act
// on belongs further down the page, or off it.
//
// Ordering is by what is already broken, then by what is merely waiting: a
// document that failed to process holds no data at all, a record carrying a
// critical flag holds data that cannot be relied on, and an unchecked value is
// simply not a record yet.

export interface PriorityInput {
  /** Extracted values sitting unconfirmed — not yet records. */
  valuesAwaitingCheck: number
  /** How many documents those values are spread across. */
  documentsAwaitingCheck: number
  /** Unresolved critical validation flags on stored records. */
  criticalFlags: number
  /** Uploads that failed to process. */
  failedDocuments: number
}

export interface PriorityItem {
  key: string
  text: string
  href: string
  actionLabel: string
  severity: 'critical' | 'warning'
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

export function buildOverviewPriorities(input: PriorityInput): PriorityItem[] {
  const items: PriorityItem[] = []

  if (input.failedDocuments > 0) {
    items.push({
      key: 'failed-documents',
      text: `${plural(input.failedDocuments, 'document')} could not be read, so nothing from ${input.failedDocuments === 1 ? 'it' : 'them'} has been saved.`,
      href: '/upload',
      actionLabel: 'Upload again',
      severity: 'critical',
    })
  }

  if (input.criticalFlags > 0) {
    items.push({
      key: 'critical-flags',
      text: `${plural(input.criticalFlags, 'record')} ${input.criticalFlags === 1 ? 'has' : 'have'} a problem that stops ${input.criticalFlags === 1 ? 'it' : 'them'} counting as verified.`,
      href: '/records',
      actionLabel: 'See what is wrong',
      severity: 'critical',
    })
  }

  if (input.valuesAwaitingCheck > 0) {
    items.push({
      key: 'awaiting-check',
      text: `${plural(input.valuesAwaitingCheck, 'value')} across ${plural(input.documentsAwaitingCheck, 'document')} ${input.valuesAwaitingCheck === 1 ? 'is' : 'are'} waiting for you to check ${input.valuesAwaitingCheck === 1 ? 'it' : 'them'}. Until you do, ${input.valuesAwaitingCheck === 1 ? 'it is' : 'they are'} not saved and cannot be shared.`,
      href: '/review',
      actionLabel: 'Check them',
      severity: 'warning',
    })
  }

  return items
}
