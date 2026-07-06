// Upgrade 10 — build the per-group DP release inputs from stored records. Pure.
//
// Groups records by sector+domain+field+unit, then reduces each group to one
// value per *canonical* entity (mean of that entity's records in the group) so
// every contributor counts once (Upgrade 5). Only fields with public bounds are
// eligible. The brain then adds calibrated noise and enforces the floor.

import { canonicalId } from './entity-canonical'
import { boundsFor } from './public-bounds'
import type { DPGroupInput } from '@/lib/brain/types'

export interface BenchmarkRow {
  entityId: string
  sector: string
  domain: string
  fieldName: string
  value: number
  unit: string
}

export function buildDpGroups(
  rows: BenchmarkRow[],
  canonicalMap: Map<string, string>,
): DPGroupInput[] {
  interface Group {
    bounds: [number, number]
    units: Map<string, { sum: number; count: number }>
  }
  const groups = new Map<string, Group>()

  for (const r of rows) {
    const bounds = boundsFor(r.fieldName)
    if (!bounds) continue
    const key = `${r.sector}__${r.domain}__${r.fieldName}__${r.unit}`
    let g = groups.get(key)
    if (!g) {
      g = { bounds, units: new Map() }
      groups.set(key, g)
    }
    const cid = canonicalId(canonicalMap, r.entityId)
    const u = g.units.get(cid) ?? { sum: 0, count: 0 }
    u.sum += r.value
    u.count += 1
    g.units.set(cid, u)
  }

  const out: DPGroupInput[] = []
  for (const [key, g] of groups) {
    // One value per canonical entity: the mean of that entity's records here.
    const values = [...g.units.values()].map(u => u.sum / u.count)
    out.push({ key, values, low: g.bounds[0], high: g.bounds[1] })
  }
  return out.sort((a, b) => a.key.localeCompare(b.key))
}
