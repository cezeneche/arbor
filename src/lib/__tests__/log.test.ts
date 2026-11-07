import { logError, logInfo, logWarn } from '../log'

// E6: server logs are one JSON object per line, so Vercel's log search can
// filter on event, request ID or error name instead of grepping prose.

let lines: { level: string; text: string }[]
beforeEach(() => {
  lines = []
  for (const level of ['error', 'warn', 'info'] as const) {
    jest.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      lines.push({ level, text: String(args[0]) })
    })
  }
})
afterEach(() => jest.restoreAllMocks())

const parsed = () => lines.map(l => ({ level: l.level, ...JSON.parse(l.text) }))

it('writes one JSON line with the event, its fields and the time', () => {
  logInfo('upload accepted', { documentId: 'doc-1', requestId: 'req_123456789' })
  expect(parsed()).toEqual([
    {
      level: 'info',
      event: 'upload accepted',
      documentId: 'doc-1',
      requestId: 'req_123456789',
      time: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    },
  ])
})

it('records an error by name and message', () => {
  logError('notification failed', new TypeError('fetch failed'), { userId: 'u1' })
  expect(parsed()[0]).toMatchObject({
    level: 'error',
    event: 'notification failed',
    userId: 'u1',
    error: { name: 'TypeError', message: 'fetch failed' },
  })
})

it('records something thrown that is not an Error', () => {
  logError('send failed', 'timeout')
  expect(parsed()[0].error).toEqual({ name: 'string', message: 'timeout' })
})

it('warns at warn level', () => {
  logWarn('replay guard off')
  expect(lines[0].level).toBe('warn')
})

it('never throws, even on a field it cannot serialise', () => {
  const loop: Record<string, unknown> = {}
  loop.self = loop
  expect(() => logError('odd', new Error('x'), { loop })).not.toThrow()
  expect(parsed()[0]).toMatchObject({ event: 'odd', error: { message: 'x' } })
})

it('records an error-shaped object, such as an email provider’s error, by its name and message', () => {
  logError('delivery failed', { name: 'validation_error', message: 'Invalid `to` field' })
  expect(parsed()[0].error).toEqual({ name: 'validation_error', message: 'Invalid `to` field' })
})

it('is the only way server code writes to the log', () => {
  const { readdirSync, readFileSync, statSync } = jest.requireActual<typeof import('fs')>('fs')
  const { join } = jest.requireActual<typeof import('path')>('path')
  const src = join(__dirname, '..', '..')
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap(name => {
      const path = join(dir, name)
      if (name === '__tests__') return []
      if (statSync(path).isDirectory()) return walk(path)
      return /\.ts$/.test(name) ? [path] : []
    })
  const offenders = ['app/api', 'lib', 'inngest']
    .flatMap(d => walk(join(src, d)))
    .filter(f => !f.endsWith(join('lib', 'log.ts')))
    .filter(f => /console\.(error|warn|log|info)\(/.test(readFileSync(f, 'utf8')))
    .map(f => f.slice(src.length + 1))
  expect(offenders).toEqual([])
})
