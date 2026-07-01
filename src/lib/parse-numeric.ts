// Shared numeric parsing for extracted and user-entered values.
//
// Values reach the write path as strings that often carry thousands separators
// ("48,250"). parseFloat stops at the comma — "48,250" becomes 48 — which
// silently corrupted stored quantities by up to 1000×. This strips thousands
// separators (a comma grouping exactly three digits) before parsing, keeps the
// decimal point, and tolerates a trailing unit as parseFloat did.
//
// Assumes English number formatting (comma = thousands, period = decimal), which
// matches the UK document universe. A lone "1,5" is not treated as a thousands
// group and parses as parseFloat would.

export function parseNumericValue(raw: string | null | undefined): number | null {
  if (raw == null) return null
  const trimmed = String(raw).trim()
  if (trimmed === '') return null
  // Drop a comma only when it separates a group of exactly three digits.
  const withoutSeparators = trimmed.replace(/,(?=\d{3}(\D|$))/g, '')
  const n = parseFloat(withoutSeparators)
  return Number.isFinite(n) ? n : null
}
