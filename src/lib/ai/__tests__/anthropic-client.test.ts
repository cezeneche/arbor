import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { AI_CALL_LIMITS, anthropicClient, worstCaseMs } from '../anthropic-client'

// E4 of the production-readiness audit. The SDK's default is ten minutes per
// attempt with two retries, half an hour in all, while a Vercel function is
// stopped at 300 seconds. A stuck call was therefore cut off by the platform
// mid-request instead of failing as an error the caller handles. Every client
// now comes from one place with a limit that fits where it runs.

const VERCEL_FUNCTION_LIMIT_MS = 300_000
const ROOT = join(__dirname, '..', '..', '..')

it('creates each client with its kind’s timeout and retries', () => {
  for (const kind of Object.keys(AI_CALL_LIMITS) as (keyof typeof AI_CALL_LIMITS)[]) {
    const client = anthropicClient(kind, 'test-key')
    expect(client.timeout).toBe(AI_CALL_LIMITS[kind].timeout)
    expect(client.maxRetries).toBe(AI_CALL_LIMITS[kind].maxRetries)
  }
})

it('lets a background call fail before Vercel stops the function', () => {
  expect(worstCaseMs('background')).toBeLessThan(VERCEL_FUNCTION_LIMIT_MS)
  expect(worstCaseMs('extraction')).toBeLessThan(VERCEL_FUNCTION_LIMIT_MS)
})

it('gives the natural-language query route room for both of its calls', () => {
  const route = readFileSync(join(ROOT, 'app/api/query/nl/route.ts'), 'utf8')
  const declared = Number(route.match(/export const maxDuration = (\d+)/)?.[1])
  // The question is parsed, then answered: two interactive calls in a row.
  expect(declared * 1000).toBeGreaterThan(2 * worstCaseMs('interactive'))
})

it('keeps the person asking a question waiting no more than a minute', () => {
  expect(2 * worstCaseMs('interactive')).toBeLessThanOrEqual(60_000)
})

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    if (name === '__tests__' || name === 'node_modules') return []
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(ts|tsx)$/.test(name) ? [path] : []
  })
}

it('creates no Anthropic client anywhere else, so none goes back to the defaults', () => {
  const offenders = sourceFiles(ROOT)
    .filter(f => !f.endsWith(join('ai', 'anthropic-client.ts')))
    .filter(f => /new Anthropic\(/.test(readFileSync(f, 'utf8')))
    .map(f => f.slice(ROOT.length + 1))
  expect(offenders).toEqual([])
})
