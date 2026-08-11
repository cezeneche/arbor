// The two ways a goods line's missing emissions figure can honestly be filled.
//
// They are not interchangeable, and this module exists so the UI cannot present
// them as though they were:
//
//   ASK THE SUPPLIER — a real measurement of the installation's production,
//   recorded as ACTUAL. What the regulation prefers, and the only route that
//   removes the mark-up. Costs time, and depends on a supplier who answers.
//
//   APPLY THE PUBLISHED DEFAULT — the Annex VI value for the route, recorded as
//   DEFAULT and carrying the legislated mark-up. Always available, and always
//   higher: the mark-up is deliberate policy, priced so that collecting real
//   data is cheaper than not collecting it.
//
// `emissionsMethod` here is Nucleos's axis — how the emissions figure was
// arrived at. It is NOT Arbor's provenance tier, which describes how the record
// was evidenced. A supplier's figure can be ACTUAL and still be DECLARED if it
// arrived without a document. Naming a default "Tier C" would merge two axes
// that have to stay separate, so no tier vocabulary appears in this file.
//
// No mark-up percentage is quoted here. The table is Nucleos's, versioned, and
// differs by regime; a second copy in TypeScript would drift, and a stale
// percentage on screen is worse than none.

export type DataPathId = 'supplier' | 'default'

/** Nucleos's method axis. Never a provenance tier. */
export type EmissionsMethod = 'ACTUAL' | 'ESTIMATED' | 'DEFAULT'

export interface DataPath {
  id: DataPathId
  title: string
  body: string
  /** What choosing this path means for the resulting figure. */
  consequence: string
  emissionsMethod: EmissionsMethod
  markupApplies: boolean
  /** True when the path works regardless of anyone else's cooperation. */
  alwaysAvailable: boolean
}

export const DATA_PATHS: readonly DataPath[] = [
  {
    id: 'supplier',
    title: 'Ask the supplier',
    body:
      'Send a link to the supplier. They fill in the emissions for the goods they ' +
      'made, without needing an account here.',
    consequence:
      'Their figure is recorded as an actual measurement, and no mark-up is added.',
    emissionsMethod: 'ACTUAL',
    markupApplies: false,
    alwaysAvailable: false,
  },
  {
    id: 'default',
    title: 'Use the published default',
    body:
      'The published value for this product and production route is applied ' +
      'instead of a figure from the supplier.',
    consequence:
      'Recorded as a default value, not a measurement, and the legislated mark-up ' +
      'is added — so the declarable amount will be higher than a supplier figure.',
    emissionsMethod: 'DEFAULT',
    markupApplies: true,
    alwaysAvailable: true,
  },
] as const

/**
 * Describe a path.
 *
 * An unknown id falls back to the default path rather than throwing: it is the
 * one that is always available, so a mistyped parameter lands on something the
 * user can actually complete.
 */
export function describePath(id: DataPathId): DataPath {
  return DATA_PATHS.find(p => p.id === id) ?? DATA_PATHS[1]
}
