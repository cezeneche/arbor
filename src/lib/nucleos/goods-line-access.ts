// Resolving a browser-supplied goods line to one the caller owns.
//
// Supplier links and relief claims both act on a goods line named by the
// browser. The line is accepted only when it sits on a case this entity owns,
// which takes two checks: the case is the caller's, and the line is on it.

import { getCbamCase } from './cases-client'
import { goodsLineBelongsToCase, resolveCaseAccess } from './case-ownership'

export type GoodsLineAccess =
  | { ok: true }
  | { ok: false; status: 400 | 404 | 502; error: string }

export async function resolveGoodsLineAccess(
  caseId: unknown,
  goodsLineId: unknown,
  entityId: string,
): Promise<GoodsLineAccess> {
  const c = typeof caseId === 'string' ? caseId.trim() : ''
  const g = typeof goodsLineId === 'string' ? goodsLineId.trim() : ''
  if (!c || !g) return { ok: false, status: 400, error: 'Choose a goods line and try again.' }

  const access = await resolveCaseAccess(c, entityId)
  if (!access.allowed) return { ok: false, status: 404, error: 'This goods line could not be found.' }

  let record: Record<string, unknown>
  try {
    record = await getCbamCase(c)
  } catch {
    return { ok: false, status: 502, error: 'This case could not be read. Please try again shortly.' }
  }
  if (!goodsLineBelongsToCase(record, g)) {
    return { ok: false, status: 404, error: 'This goods line could not be found.' }
  }
  return { ok: true }
}
