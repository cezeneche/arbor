import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// The JSON Schema files under contract/schemas are the neutral source. Nothing
// stops someone editing the generated TypeScript by hand, or editing a schema and
// forgetting to regenerate — except this.
//
// Nucleos now lives in this repo under nucleos/, so both vendored copies can be
// compared directly rather than each against a digest. The digest checks stay:
// they catch a schema edited without regenerating, which comparing the copies
// would not, since both could be edited together.

const REPO_ROOT = resolve(__dirname, '../../../..')
const GENERATOR = resolve(REPO_ROOT, 'contract/generate.py')
const GENERATED_TS = resolve(REPO_ROOT, 'src/lib/nucleos/contract.ts')
const DIGEST_FILE = resolve(REPO_ROOT, 'contract/DIGEST')

function runGenerator(...args: string[]): { status: number; output: string } {
  try {
    const output = execFileSync('python3', [GENERATOR, ...args], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    })
    return { status: 0, output }
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string }
    return { status: e.status ?? 1, output: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}

describe('nucleos contract', () => {
  it('generated types match the vendored schemas', () => {
    const { status, output } = runGenerator('--check', '--typescript', GENERATED_TS)
    expect(
      status === 0
        ? ''
        : `Generated contract types have drifted from the schemas.\n${output}\n` +
          'Regenerate: python3 contract/generate.py --typescript src/lib/nucleos/contract.ts',
    ).toBe('')
  })

  it('schemas hash to the committed digest', () => {
    const { status, output } = runGenerator('--digest')
    expect(status).toBe(0)
    const current = output.trim()
    const committed = readFileSync(DIGEST_FILE, 'utf8').trim()
    expect(
      current === committed
        ? ''
        : 'The contract schemas changed but contract/DIGEST was not updated.\n' +
          `  committed: ${committed}\n  current:   ${current}\n` +
          'Regenerate: npm run contract:generate, then sync nucleos/contract/.',
    ).toBe('')
  })

  it('keeps the two axes separate', () => {
    // A single enum covering both would typecheck and lose the distinction the
    // contract exists to preserve.
    const source = readFileSync(GENERATED_TS, 'utf8')
    expect(source).toContain("export type EmissionsMethod = 'ACTUAL' | 'ESTIMATED' | 'DEFAULT'")
    expect(source).toContain("export type ProvenanceTier = 'VERIFIED' | 'DECLARED' | 'ESTIMATED'")
    expect(source).toMatch(/emissions_method: EmissionsMethod/)
    expect(source).toMatch(/provenance_tier: ProvenanceTier/)
  })

  it('both vendored copies of the schemas are byte-identical', () => {
    // Only possible now that Nucleos lives in this repo. The two-repo version of
    // this check could compare each side against a committed digest but never
    // against each other, so a matching digest was the strongest evidence
    // available. Here the schemas themselves are compared, which is the thing
    // the digest was standing in for.
    const arborDir = resolve(REPO_ROOT, 'contract/schemas')
    const nucleosDir = resolve(REPO_ROOT, 'nucleos/contract/schemas')

    const arborFiles = readdirSync(arborDir).sort()
    const nucleosFiles = readdirSync(nucleosDir).sort()
    expect(nucleosFiles).toEqual(arborFiles)

    for (const name of arborFiles) {
      expect(readFileSync(resolve(nucleosDir, name), 'utf8')).toBe(
        readFileSync(resolve(arborDir, name), 'utf8'),
      )
    }
  })

  it('both repos pin the same digest', () => {
    expect(readFileSync(resolve(REPO_ROOT, 'nucleos/contract/DIGEST'), 'utf8').trim()).toBe(
      readFileSync(DIGEST_FILE, 'utf8').trim(),
    )
  })

  it('no payload carries a document blob', () => {
    // Document blobs stop crossing the boundary in Phase 2. A schema that accepts
    // a blob reference is how that quietly comes back.
    const source = readFileSync(GENERATED_TS, 'utf8')
    for (const banned of ['blobUrl', 'blob_url', 'content_base64', 'storage_uri', 'file_url']) {
      expect(source).not.toContain(banned)
    }
  })
})
