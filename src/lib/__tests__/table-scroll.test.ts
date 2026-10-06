import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative } from 'path'

// A table on a product screen must never be clipped (code review R2). The
// portal is desktop-only, but a small laptop leaves the eight-column Records
// table less room than it needs, and a card with `overflow: 'hidden'` cut the
// last columns off with no way to reach them. Cards that hold a table scroll
// sideways instead (`overflowX: 'auto'`, which keeps the rounded corners).
//
// jsdom has no layout, so this reads the source: the element that opens
// directly before each <table> must not set overflow to hidden.

const ROOT = join(__dirname, '..', '..')
const EXEMPT = ['app/(marketing)/', 'components/marketing/', 'app/institutional/']

function files(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : files(path)
    return /\.tsx$/.test(name) ? [path] : []
  })
}

/** The opening tag (with its style) of the element enclosing each table. */
function wrappersOfTables(source: string): { line: number; tag: string }[] {
  const found: { line: number; tag: string }[] = []
  for (const match of source.matchAll(/<table\b/g)) {
    const before = source.slice(0, match.index)
    const open = before.lastIndexOf('<div')
    if (open === -1) continue
    found.push({ line: before.split('\n').length, tag: before.slice(open) })
  }
  return found
}

test('no product table sits in a card that clips it', () => {
  const offenders = [join(ROOT, 'app'), join(ROOT, 'components')]
    .flatMap(files)
    .map(path => relative(ROOT, path))
    .filter(path => !EXEMPT.some(prefix => path.startsWith(prefix)))
    .flatMap(path =>
      wrappersOfTables(readFileSync(join(ROOT, path), 'utf8'))
        .filter(w => /overflow:\s*'hidden'/.test(w.tag))
        .map(w => `${path}:${w.line}`),
    )
  expect(offenders).toEqual([])
})
