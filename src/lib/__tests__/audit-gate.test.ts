import { execFileSync } from 'node:child_process'

// E5: CI fails on any high or critical advisory in production dependencies.
// The one exception is an advisory with no upstream fix, accepted for the exact
// copy it affects, with a reason and a date by which it must be looked at
// again. Allowing it by advisory alone would also hide the same advisory if a
// direct dependency regressed to a vulnerable version.

function gate(audit: unknown, allowlist: unknown, today = '2026-11-07') {
  const code = `import(${JSON.stringify(`${process.cwd()}/scripts/ci/audit-gate.mjs`)}).then(m =>
    process.stdout.write(JSON.stringify(m.auditFailures(...JSON.parse(process.argv[1])))))`
  return JSON.parse(
    execFileSync('node', ['--input-type=module', '-e', code, JSON.stringify([audit, allowlist, today])], {
      encoding: 'utf8',
    }),
  ) as { failures: string[]; unused: string[] }
}

const zodAdvisory = {
  source: 1,
  name: 'zod',
  title: 'Zod can exhaust memory',
  url: 'https://github.com/advisories/GHSA-mrhx-c7xc-m3w5',
  severity: 'high',
}

function audit(nodes: string[], advisory = zodAdvisory) {
  return {
    vulnerabilities: {
      [advisory.name]: { name: advisory.name, severity: advisory.severity, via: [advisory], nodes },
      inngest: { name: 'inngest', severity: 'high', via: ['zod'], nodes: ['node_modules/inngest'] },
    },
  }
}

const allow = [
  {
    advisory: 'GHSA-mrhx-c7xc-m3w5',
    nodes: ['node_modules/inngest/node_modules/zod'],
    reason: 'inngest requires zod 3; no zod 3 release carries the fix',
    reviewBy: '2027-02-01',
  },
]

it('passes when the only advisory is the accepted copy', () => {
  expect(gate(audit(['node_modules/inngest/node_modules/zod']), allow)).toEqual({ failures: [], unused: [] })
})

it('fails when the same advisory reaches another copy', () => {
  const result = gate(audit(['node_modules/inngest/node_modules/zod', 'node_modules/zod']), allow)
  expect(result.failures).toEqual([
    'high: zod (node_modules/zod) — Zod can exhaust memory — GHSA-mrhx-c7xc-m3w5',
  ])
})

it('fails on a high or critical advisory nobody accepted', () => {
  const next = {
    ...zodAdvisory,
    name: 'next',
    title: 'RCE',
    url: 'https://github.com/advisories/GHSA-aaaa',
    severity: 'critical',
  }
  expect(gate(audit(['node_modules/next'], next), allow).failures).toEqual([
    'critical: next (node_modules/next) — RCE — GHSA-aaaa',
  ])
})

it('ignores moderate and low advisories', () => {
  const minor = {
    ...zodAdvisory,
    name: 'x',
    severity: 'moderate',
    url: 'https://github.com/advisories/GHSA-bbbb',
  }
  expect(gate(audit(['node_modules/x'], minor), []).failures).toEqual([])
})

it('fails once an accepted advisory passes its review date', () => {
  const result = gate(audit(['node_modules/inngest/node_modules/zod']), allow, '2027-02-02')
  expect(result.failures).toEqual([
    'GHSA-mrhx-c7xc-m3w5: accepted until 2027-02-01; look at it again (inngest requires zod 3; no zod 3 release carries the fix)',
  ])
})

it('reports an accepted advisory that no longer appears, so it can be removed', () => {
  expect(gate({ vulnerabilities: {} }, allow).unused).toEqual(['GHSA-mrhx-c7xc-m3w5'])
})
