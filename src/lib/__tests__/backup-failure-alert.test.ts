import { execFileSync } from 'node:child_process'

// A failed nightly backup means there is no fresh copy of the database outside
// Supabase, which is the outage this whole job exists for. It goes to the ops
// Slack channel in the shared format (contract/alerts), rendered by the same
// Python module Nucleos uses, so the workflow needs nothing installed.

function render(env: Record<string, string>) {
  const out = execFileSync('python3', ['scripts/backup/notify_failure.py'], {
    encoding: 'utf8',
    env: { NODE_ENV: 'test', PATH: process.env.PATH ?? '', BACKUP_ALERT_DRY_RUN: '1', ...env },
  })
  return JSON.parse(out) as { text: string; blocks: { text?: { text: string } }[] }
}

const env = {
  KIND: 'arbor',
  RUN_URL: 'https://github.com/cezeneche/arbor/actions/runs/1',
}

it('raises a critical alert naming the database and linking to the run', () => {
  const message = render(env)
  const text = JSON.stringify(message)
  expect(text).toContain('Action needed')
  expect(text).toContain('Arbor database backup failed')
  expect(text).toContain('no new copy outside Supabase')
  expect(text).toContain('https://github.com/cezeneche/arbor/actions/runs/1')
})

it('names Nucleos when its backup fails', () => {
  expect(JSON.stringify(render({ ...env, KIND: 'nucleos' }))).toContain('Nucleos database backup failed')
})

it('sends nothing and does not fail when no webhook is configured', () => {
  const out = execFileSync('python3', ['scripts/backup/notify_failure.py'], {
    encoding: 'utf8',
    env: { NODE_ENV: 'test', PATH: process.env.PATH ?? '', ...env },
  })
  expect(out).toContain('OPS_SLACK_WEBHOOK_URL is not set')
})
