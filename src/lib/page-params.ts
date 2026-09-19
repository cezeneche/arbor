// limit/offset for list APIs, so a list reads a bounded page rather than the
// whole store.
export const DEFAULT_PAGE_SIZE = 500
export const MAX_PAGE_SIZE = 1000

export function parsePageParams(
  params: URLSearchParams,
): { ok: true; limit: number; offset: number } | { ok: false; error: string } {
  const whole = (raw: string | null, min: number) => {
    if (raw === null) return null
    const n = Number(raw)
    return Number.isInteger(n) && n >= min ? n : NaN
  }
  const limit = whole(params.get('limit'), 1)
  const offset = whole(params.get('offset'), 0)
  if (Number.isNaN(limit)) return { ok: false, error: 'limit must be a whole number of at least 1' }
  if (Number.isNaN(offset)) return { ok: false, error: 'offset must be a whole number of at least 0' }
  return { ok: true, limit: Math.min(limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE), offset: offset ?? 0 }
}
