import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Each Vercel project builds only when its own code changed: Arbor (root ".")
// skips commits that touch only nucleos/, and nucleos-api (root "nucleos")
// skips commits that touch nothing under it. On 7 November every Dependabot PR
// built both, and the Hobby plan's build limit stopped production deploys.
//
// Vercel's convention: the ignore command exits 0 to skip the build and 1 to
// build. Any other exit code fails the deployment. git exits 128 when the
// previous deployment's commit no longer exists, as after a rebase or force
// push (Dependabot rebases its PRs), and on 9 November that failed the preview
// of #190. So every error must become exit 1: build, never skip, never fail.
// These run the exact commands from both vercel.json files.

const REPO = join(__dirname, '..', '..', '..')
const command = (file: string) => JSON.parse(readFileSync(join(REPO, file), 'utf8')).ignoreCommand as string
const ARBOR = command('vercel.json')
const NUCLEOS = command('nucleos/vercel.json')

let dir: string
const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim()
function commit(path: string): string {
  writeFileSync(join(dir, path), `${Math.random()}\n`)
  git('add', '-A')
  git('commit', '-q', '-m', `change ${path}`)
  return git('rev-parse', 'HEAD')
}
/** true = Vercel builds; false = it skips. Any other exit code fails the deployment. */
function builds(cmd: string, cwd: string, previousSha?: string): boolean {
  const env = {
    NODE_ENV: 'test' as const,
    PATH: process.env.PATH ?? '',
    HOME: dir,
    ...(previousSha ? { VERCEL_GIT_PREVIOUS_SHA: previousSha } : {}),
  }
  const status = spawnSync('sh', ['-c', cmd], { cwd, env }).status
  if (status === 0) return false
  if (status === 1) return true
  throw new Error(`exit ${status}: Vercel would fail this deployment`)
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ignored-build-'))
  mkdirSync(join(dir, 'src'))
  mkdirSync(join(dir, 'nucleos'))
  git('init', '-q')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'test')
  writeFileSync(join(dir, 'src', 'page.ts'), 'a\n')
  writeFileSync(join(dir, 'nucleos', 'main.py'), 'a\n')
  git('add', '-A')
  git('commit', '-q', '-m', 'base')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

it('builds only Nucleos when only Nucleos changed', () => {
  commit('nucleos/main.py')
  expect(builds(ARBOR, dir)).toBe(false)
  expect(builds(NUCLEOS, join(dir, 'nucleos'))).toBe(true)
})

it('builds only Arbor when only Arbor changed', () => {
  commit('src/page.ts')
  expect(builds(ARBOR, dir)).toBe(true)
  expect(builds(NUCLEOS, join(dir, 'nucleos'))).toBe(false)
})

it('builds both when both changed', () => {
  writeFileSync(join(dir, 'src', 'page.ts'), 'b\n')
  commit('nucleos/main.py')
  expect(builds(ARBOR, dir)).toBe(true)
  expect(builds(NUCLEOS, join(dir, 'nucleos'))).toBe(true)
})

it('compares against the last deployed commit, not just the newest one', () => {
  const deployed = git('rev-parse', 'HEAD')
  commit('nucleos/main.py')
  commit('src/page.ts')
  // The newest commit touched only Arbor, but Nucleos changed since its last deploy.
  expect(builds(NUCLEOS, join(dir, 'nucleos'), deployed)).toBe(true)
})

it('builds when the last deployed commit was rewritten away (rebase, force push)', () => {
  const rebasedAway = commit('src/page.ts')
  git('reset', '-q', '--hard', 'HEAD^')
  git('reflog', 'expire', '--expire=now', '--all')
  git('gc', '-q', '--prune=now')
  commit('nucleos/main.py')
  expect(builds(ARBOR, dir, rebasedAway)).toBe(true)
  expect(builds(NUCLEOS, join(dir, 'nucleos'), rebasedAway)).toBe(true)
})

it('builds when it cannot tell, rather than skipping', () => {
  commit('src/page.ts')
  const unknown = 'f'.repeat(40)
  expect(builds(ARBOR, dir, unknown)).toBe(true)
  expect(builds(NUCLEOS, join(dir, 'nucleos'), unknown)).toBe(true)
})
