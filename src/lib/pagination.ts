// Page and limit from a query string. Only plain whole numbers count; anything
// else (empty, text, negative, a decimal, NaN) means the default, so it can
// never reach Prisma as `skip: NaN`.

/** Far beyond any real listing, and small enough that skip stays exact. */
const MAX_PAGE = 1_000_000

function wholeNumber(raw: string | null | undefined): number | null {
  if (!raw || !/^\d+$/.test(raw)) return null
  const n = Number(raw)
  return Number.isSafeInteger(n) ? n : null
}

export function parsePage(raw: string | null | undefined): number {
  const n = wholeNumber(raw)
  return n !== null && n >= 1 && n <= MAX_PAGE ? n : 1
}

export function parseLimit(
  raw: string | null | undefined,
  { fallback, max }: { fallback: number; max: number },
): number {
  const n = wholeNumber(raw)
  if (n === null || n < 1) return fallback
  return Math.min(n, max)
}
