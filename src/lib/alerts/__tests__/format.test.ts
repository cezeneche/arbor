import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderEmail, renderSlack, type Alert } from '@/lib/alerts/format'

// The golden cases are shared with Nucleos's renderer
// (nucleos/api/ledger_app/services/alert_format.py), so a message looks the same
// whichever system sends it. See contract/alerts/README.md for the rules.
interface GoldenCase {
  name: string
  alert: Omit<Alert, 'at'> & { at: string }
  slack: unknown
  email: unknown
}

const golden: GoldenCase[] = JSON.parse(
  readFileSync(join(process.cwd(), 'contract/alerts/golden.json'), 'utf8'),
)

const toAlert = (c: GoldenCase): Alert => ({ ...c.alert, at: new Date(c.alert.at) })

describe('alert format (golden cases)', () => {
  // Expected: each rendering equals the hand-written payload exactly.
  // Reason: the format is the contract; any change must be made in the golden
  // file first, where Nucleos's test sees it too.
  it.each(golden.map(c => [c.name, c] as const))('%s: Slack', (_name, c) => {
    expect(renderSlack(toAlert(c))).toEqual(c.slack)
  })

  it.each(golden.map(c => [c.name, c] as const))('%s: email', (_name, c) => {
    expect(renderEmail(toAlert(c))).toEqual(c.email)
  })
})

describe('alert format limits', () => {
  const base: Alert = {
    severity: 'warning',
    source: 'Arbor',
    environment: 'production',
    title: 'Something',
    summary: 'Something happened.',
    at: new Date('2026-10-17T14:03:00Z'),
  }

  // Expected: at most 10 fields. Reason: Slack rejects a section with more,
  // which would lose the whole message.
  it('renders at most ten facts', () => {
    const facts = Array.from({ length: 12 }, (_, i) => ({ label: `L${i}`, value: `v${i}` }))
    const blocks = renderSlack({ ...base, facts }).blocks as { fields?: unknown[] }[]
    expect(blocks.find(b => b.fields)?.fields).toHaveLength(10)
  })

  // Expected: emoji and other astral characters count as one character each.
  // Reason: Python counts code points; counting UTF-16 units would cut titles at
  // a different place in each language, or split an emoji in half.
  it('cuts titles by characters, not UTF-16 units', () => {
    const title = '🚀'.repeat(160)
    const { text } = renderSlack({ ...base, title })
    expect(Array.from(text.replace('Warning: ', ''))).toHaveLength(150)
  })

  // Expected: an http(s) link becomes a button; any other scheme is dropped.
  it.each([
    ['https://arbor.example/x', true],
    ['http://localhost:3000/x', true],
    ['mailto:a@b.c', false],
    ['/relative', false],
  ])('link %s → button %s', (url, kept) => {
    const blocks = renderSlack({ ...base, link: { label: 'Open', url } }).blocks as { type: string }[]
    expect(blocks.some(b => b.type === 'actions')).toBe(kept)
  })
})
