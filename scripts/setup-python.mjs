#!/usr/bin/env node
// Create the Nucleos virtualenv, so the merged repo has one way to run everything.
//
// Before this, `npm test` covered Arbor's TypeScript and nothing covered
// Nucleos's 52 Python test files or its 18 golden cases from a clean checkout —
// there was no venv, no bootstrap, and no single command. Half the product's
// test suite was, in effect, opt-in for whoever already had an environment.
//
//   npm run python:setup     create nucleos/.venv and install requirements
//   npm run test:python      run the Python suite
//   npm run test:all         both suites, TypeScript first
//
// Idempotent. Re-running against an existing venv reinstalls requirements,
// which is what you want after a dependency changes and harmless otherwise.

import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { DEFAULT_VENV, NUCLEOS_DIR, findVenvBin, pythonPath } from './python-env.mjs'

const REQUIREMENTS = path.join(NUCLEOS_DIR, 'api', 'requirements.txt')

if (!existsSync(REQUIREMENTS)) {
  console.error(`No requirements file at ${REQUIREMENTS}. Is the nucleos/ directory present?`)
  process.exit(2)
}

// Nucleos's pinned dependencies (numpy 2.2, fastapi 0.128, pydantic 2.12) need
// 3.10 at minimum; 3.11 is the floor here because that is what the pins were
// resolved against. macOS still ships 3.9 as `python3`, so taking the first
// interpreter on PATH fails deep inside pip with a wall of version exclusions
// that never names the actual problem.
const MIN_MINOR = 11

function versionOf(command) {
  const probe = spawnSync(command, ['--version'], { encoding: 'utf8' })
  if (probe.status !== 0) return null
  const match = /Python (\d+)\.(\d+)/.exec(`${probe.stdout}${probe.stderr}`)
  return match ? { major: Number(match[1]), minor: Number(match[2]) } : null
}

/** The interpreter to build the venv with. Not a venv python — a base one. */
function systemPython() {
  const candidates = [
    process.env.PYTHON,
    'python3.14',
    'python3.13',
    'python3.12',
    'python3.11',
    'python3',
    'python',
  ].filter(Boolean)

  let best = null
  for (const candidate of candidates) {
    const version = versionOf(candidate)
    if (!version) continue
    if (version.major === 3 && version.minor >= MIN_MINOR) return candidate
    if (!best) best = { candidate, version }
  }

  console.error(
    best
      ? `The Python on PATH is ${best.candidate} ${best.version.major}.${best.version.minor}. ` +
          `Nucleos needs 3.${MIN_MINOR} or newer.\n` +
          '    macOS:  brew install python@3.13\n' +
          '    Or point at one:  PYTHON=/path/to/python3.13 npm run python:setup'
      : `No Python found on PATH. Install 3.${MIN_MINOR} or newer and try again.`,
  )
  process.exit(2)
}

// Never an activated venv: installing into one the user happens to be inside
// would put Nucleos's pins over another project's.
const existing = findVenvBin({ includeActive: false })
if (existing) {
  console.log(`Using the existing virtualenv at ${path.dirname(existing)}`)
} else {
  const py = systemPython()
  console.log(`Creating ${DEFAULT_VENV} …`)
  execFileSync(py, ['-m', 'venv', DEFAULT_VENV], { stdio: 'inherit' })
}

const bin = findVenvBin({ includeActive: false })
if (!bin) {
  console.error('The virtualenv was created but has no interpreter in it. Delete it and retry.')
  process.exit(2)
}

console.log('Installing Nucleos requirements (this takes a few minutes the first time) …')
execFileSync(pythonPath(bin), ['-m', 'pip', 'install', '--upgrade', 'pip'], { stdio: 'inherit' })
execFileSync(pythonPath(bin), ['-m', 'pip', 'install', '-r', REQUIREMENTS], { stdio: 'inherit' })

console.log('\nDone. Now:')
console.log('    npm run test:python      run the Nucleos suite')
console.log('    npm run verify:boundary  prove the two halves agree')
