import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

// grant-scope.ts is the one rule for what a buyer may read of a supplier. Read
// paths that re-derived it inline kept the domain and period checks and dropped
// the field restriction, so a field-scoped grant disclosed every field on the
// supplier records page, the v1 supply-chain API and unit conversion. This
// fails if the inline form comes back anywhere else.

const ROOT = join(__dirname, '..', '..', '..')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    if (name === '__tests__' || name === 'node_modules') return []
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(ts|tsx)$/.test(name) ? [path] : []
  })
}

const INLINE_RULE = /grant\.domain\s*===\s*record\.domain|record\.periodEnd\s*>=\s*grant\.periodStart/

it('no read path re-implements the grant rule instead of calling grant-scope', () => {
  const offenders = sourceFiles(ROOT)
    .filter(f => !f.endsWith(join('layer3', 'grant-scope.ts')))
    .filter(f => INLINE_RULE.test(readFileSync(f, 'utf8')))
    .map(f => f.slice(ROOT.length + 1))
  expect(offenders).toEqual([])
})
