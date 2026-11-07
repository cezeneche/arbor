// Server logs as one JSON object per line (E6), so Vercel's log search can
// filter on the event, the request ID or the error rather than grep prose.
// Never log personal data here: pass IDs, not emails or names.

type Level = 'error' | 'warn' | 'info'
type Fields = Record<string, unknown>

function describe(err: unknown): { name: string; message: string } {
  if (err instanceof Error) return { name: err.name, message: err.message }
  if (err && typeof err === 'object' && 'message' in err) {
    const { name, message } = err as { name?: unknown; message?: unknown }
    return { name: String(name ?? 'Error'), message: String(message) }
  }
  return { name: typeof err, message: String(err) }
}

function write(level: Level, event: string, fields: Fields): void {
  const time = new Date().toISOString()
  let line: string
  try {
    line = JSON.stringify({ event, ...fields, time })
  } catch {
    // A field that cannot be serialised must not lose the event itself.
    line = JSON.stringify({ event, error: fields.error, time, note: 'some fields could not be logged' })
  }
  console[level](line)
}

export function logError(event: string, err?: unknown, fields: Fields = {}): void {
  write('error', event, err === undefined ? fields : { ...fields, error: describe(err) })
}

export function logWarn(event: string, fields: Fields = {}): void {
  write('warn', event, fields)
}

export function logInfo(event: string, fields: Fields = {}): void {
  write('info', event, fields)
}
