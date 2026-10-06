import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative } from 'path'

// Design rule: every colour on a product screen comes from src/lib/design-system.ts.
// The public marketing site is the documented exception (its own --mk- tokens
// in marketing.css), and tests may use literal colours.

const ROOT = join(__dirname, '..', '..')
const EXEMPT = ['lib/design-system.ts', 'app/(marketing)/', 'components/marketing/', 'app/institutional/']
const RAW_COLOUR = /#[0-9A-Fa-f]{6}\b|#[0-9A-Fa-f]{3}\b(?=['"`])|rgba?\(/

function files(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : files(path)
    return /\.tsx?$/.test(name) ? [path] : []
  })
}

test('product screens use design-system colours only', () => {
  const offenders = [join(ROOT, 'app'), join(ROOT, 'components')]
    .flatMap(files)
    .map(path => relative(ROOT, path))
    .filter(path => !EXEMPT.some(prefix => path.startsWith(prefix)))
    .flatMap(path =>
      readFileSync(join(ROOT, path), 'utf8')
        .split('\n')
        .map((line, i) => (RAW_COLOUR.test(line) ? `${path}:${i + 1}: ${line.trim()}` : null))
        .filter((hit): hit is string => hit !== null),
    )
  expect(offenders).toEqual([])
})
