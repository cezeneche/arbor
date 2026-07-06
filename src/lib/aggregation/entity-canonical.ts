// Upgrade 10 (uses Upgrade 5) — collapse confirmed same-entity links into one
// canonical aggregation unit. Pure: no DB, no network.
//
// Differential privacy protects a *contributor*. If one real-world company
// appears as two Entity rows, it would count as two contributors — inflating a
// group past the population floor and diluting the noise that hides it. So before
// aggregating we map every entity to the canonical id of its confirmed-SAME_AS
// component (the smallest id, deterministically), and aggregate per canonical.

export interface EntityLinkPair {
  entityAId: string
  entityBId: string
}

/** Union-find over confirmed links → map from each linked entity to its
 *  component's canonical (smallest) id. */
export function buildCanonicalMap(links: EntityLinkPair[]): Map<string, string> {
  const parent = new Map<string, string>()

  const find = (x: string): string => {
    if (!parent.has(x)) {
      parent.set(x, x)
      return x
    }
    let root = x
    while (parent.get(root)! !== root) root = parent.get(root)!
    // Path compression.
    let cur = x
    while (parent.get(cur)! !== root) {
      const next = parent.get(cur)!
      parent.set(cur, root)
      cur = next
    }
    return root
  }

  const union = (a: string, b: string): void => {
    const ra = find(a)
    const rb = find(b)
    if (ra === rb) return
    // Keep the smaller id as the root so the canonical id is stable and minimal.
    if (ra < rb) parent.set(rb, ra)
    else parent.set(ra, rb)
  }

  for (const l of links) union(l.entityAId, l.entityBId)

  const result = new Map<string, string>()
  for (const id of parent.keys()) result.set(id, find(id))
  return result
}

/** The canonical id for an entity — its component's id, or itself if unlinked. */
export function canonicalId(map: Map<string, string>, id: string): string {
  return map.get(id) ?? id
}
