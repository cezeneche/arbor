// Where the Nucleos virtualenv is, and how to make one.
//
// This used to be two paths hardcoded in verify-boundary.mjs, the second of
// which was somebody's home directory. On any other machine the boundary check
// could not run at all, and the message it gave named a path that would never
// exist there — so the one check that proves the two halves of the product
// agree was, in practice, unrunnable from a clean checkout.
//
// Resolution order:
//   1. NUCLEOS_VENV, when the caller has one somewhere else
//   2. nucleos/.venv, which `npm run python:setup` creates
//   3. an already-active virtualenv (VIRTUAL_ENV)
//
// Nothing outside the repo, and no personal paths.

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

export const REPO_ROOT = path.resolve(import.meta.dirname, '..')
export const NUCLEOS_DIR = path.join(REPO_ROOT, 'nucleos')
export const DEFAULT_VENV = path.join(NUCLEOS_DIR, '.venv')

/** The bin directory of a virtualenv, on this platform. */
function binDir(venvRoot) {
  return path.join(venvRoot, process.platform === 'win32' ? 'Scripts' : 'bin')
}

function hasPython(bin) {
  return existsSync(path.join(bin, process.platform === 'win32' ? 'python.exe' : 'python'))
}

/**
 * The venv bin directory to use, or null when there is none.
 *
 * Never falls back to the system python. A run against whatever happens to be
 * on PATH would either fail on a missing dependency or — worse — succeed
 * against a different version of one, which is a boundary check that proves
 * nothing about the deployed service.
 */
export function findVenvBin({ includeActive = true } = {}) {
  const candidates = [
    process.env.NUCLEOS_VENV ? binDir(process.env.NUCLEOS_VENV) : null,
    binDir(DEFAULT_VENV),
    // An already-activated venv is a fine place to RUN from, and a bad place to
    // install into: `npm run python:setup` from inside an unrelated activated
    // environment would install Nucleos's pins over whatever that project
    // needs. Setup passes includeActive: false for that reason.
    includeActive && process.env.VIRTUAL_ENV ? binDir(process.env.VIRTUAL_ENV) : null,
  ].filter(Boolean)

  return candidates.find(hasPython) ?? null
}

export function describeMissingVenv() {
  return [
    'No Nucleos virtualenv found.',
    '',
    'Create one with:',
    '    npm run python:setup',
    '',
    'Or point at an existing one:',
    '    NUCLEOS_VENV=/path/to/venv npm run verify:boundary',
  ].join('\n')
}

/** The venv bin directory, or exit with instructions. */
export function requireVenvBin() {
  const bin = findVenvBin()
  if (!bin) {
    console.error(describeMissingVenv())
    process.exit(2)
  }
  return bin
}

export function pythonPath(bin) {
  return path.join(bin, process.platform === 'win32' ? 'python.exe' : 'python')
}

/** Run a command in the venv, inheriting stdio. Throws on non-zero exit. */
export function runInVenv(bin, args, opts = {}) {
  return execFileSync(pythonPath(bin), args, {
    cwd: NUCLEOS_DIR,
    stdio: 'inherit',
    ...opts,
  })
}
