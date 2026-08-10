import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// The JSON Schema files under contract/schemas are the neutral source, vendored
// from Nucleos. Nothing stops someone editing the generated TypeScript by hand,
// or editing a schema and forgetting to regenerate — except this.
//
// It proves this repo's generated types match this repo's schemas, and that the
// schemas hash to the committed digest. It cannot reach into Nucleos. The digest
// is what makes divergence visible: changing a schema changes the digest, and a
// digest that differs between the repos surfaces in review rather than as a
// runtime shape mismatch months later.

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
          'Update the digest in BOTH repos and re-vendor the schemas.',
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

  it('no payload carries a document blob', () => {
    // Document blobs stop crossing the boundary in Phase 2. A schema that accepts
    // a blob reference is how that quietly comes back.
    const source = readFileSync(GENERATED_TS, 'utf8')
    for (const banned of ['blobUrl', 'blob_url', 'content_base64', 'storage_uri', 'file_url']) {
      expect(source).not.toContain(banned)
    }
  })
})
