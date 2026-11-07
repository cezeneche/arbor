#!/usr/bin/env node
// CI's dependency gate (E5): fails on any high or critical advisory in
// production dependencies, except those accepted in audit-allowlist.json for
// the exact copies they affect, until their review date.
//
//   node scripts/ci/audit-gate.mjs
//
// An advisory is accepted only where no fixed version can be installed. Each
// entry names the advisory, the node_modules paths it is accepted for, why,
// and a reviewBy date after which it fails again.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const BLOCKING = new Set(['high', 'critical'])

const advisoryId = url => url?.split('/').pop() ?? 'unknown'

/** Pure: the blocking findings in an `npm audit --json` report, given the allowlist and today's date. */
export function auditFailures(audit, allowlist, today) {
  const failures = []
  const seen = new Set()
  const allowed = new Map(allowlist.map(a => [a.advisory, a]))

  for (const vuln of Object.values(audit.vulnerabilities ?? {})) {
    for (const via of vuln.via ?? []) {
      // A string names another package whose own advisory is listed separately.
      if (typeof via === 'string' || !BLOCKING.has(via.severity)) continue
      const id = advisoryId(via.url)
      seen.add(id)
      const accepted = allowed.get(id)
      if (accepted && accepted.reviewBy < today) {
        const line = `${id}: accepted until ${accepted.reviewBy}; look at it again (${accepted.reason})`
        if (!failures.includes(line)) failures.push(line)
        continue
      }
      for (const node of vuln.nodes ?? []) {
        if (accepted?.nodes.includes(node)) continue
        failures.push(`${via.severity}: ${vuln.name} (${node}) — ${via.title} — ${id}`)
      }
    }
  }
  const unused = allowlist.map(a => a.advisory).filter(id => !seen.has(id))
  return { failures, unused }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  let raw
  try {
    raw = execFileSync('npm', ['audit', '--omit=dev', '--json'], { encoding: 'utf8', maxBuffer: 64 << 20 })
  } catch (e) {
    // npm audit exits non-zero whenever it finds anything; the report is still on stdout.
    raw = e.stdout
  }
  const allowlist = JSON.parse(readFileSync(new URL('./audit-allowlist.json', import.meta.url), 'utf8'))
  const { failures, unused } = auditFailures(
    JSON.parse(raw),
    allowlist,
    new Date().toISOString().slice(0, 10),
  )
  for (const id of unused) console.log(`No longer reported, remove from audit-allowlist.json: ${id}`)
  if (failures.length > 0) {
    console.error('High or critical advisories in production dependencies:')
    for (const f of failures) console.error(`  - ${f}`)
    console.error(
      'Upgrade the dependency. Accept one only when no fixed version exists (scripts/ci/audit-allowlist.json).',
    )
    process.exit(1)
  }
  console.log('No unaccepted high or critical advisories in production dependencies.')
}
