import {
  acceptVerification,
  recordVerificationStatement,
  rejectVerification,
  requestVerification,
  VerificationRejectedError,
} from '../verification-client'
import { NucleosUnavailableError } from '../extraction-client'

// The four Nucleos calls behind a verifier's statement. The statement itself is
// an Arbor document; what crosses the boundary is a reference and its hash.

const ORIGINAL = { ...process.env }
beforeEach(() => {
  process.env.NUCLEOS_URL = 'https://nucleos.test'
  process.env.NUCLEOS_INTERNAL_TOKEN = 'token'
})
afterEach(() => {
  process.env = { ...ORIGINAL }
})

function fake(status = 200, body: unknown = {}) {
  const calls: { url: string; init: RequestInit }[] = []
  const impl = jest.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return new Response(JSON.stringify(body), { status })
  })
  return { impl: impl as unknown as typeof fetch, calls }
}

describe('verification client', () => {
  it('asks Nucleos to expect a statement for the goods line', async () => {
    const { impl, calls } = fake()
    await requestVerification('gl-1', impl)
    expect(calls[0].url).toBe('https://nucleos.test/api/cbam/goods-lines/gl-1/request-verification')
    expect(calls[0].init.method).toBe('POST')
  })

  it('sends the statement as a reference and hash, never the file', async () => {
    const { impl, calls } = fake()
    await recordVerificationStatement(
      'gl-1',
      {
        verifierName: 'Carbon Assurance Ltd',
        verifierAccreditation: 'UKAS 9876',
        documentRef: 'arbor:verification:stmt-1',
        sha256: 'a'.repeat(64),
      },
      impl,
    )
    expect(calls[0].url).toBe('https://nucleos.test/api/cbam/goods-lines/gl-1/upload-verification')
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      verifier_name: 'Carbon Assurance Ltd',
      verifier_accreditation: 'UKAS 9876',
      document_ref: 'arbor:verification:stmt-1',
      document_sha256: 'a'.repeat(64),
    })
  })

  it('accepts and rejects, with the rejection reason', async () => {
    const accept = fake()
    await acceptVerification('gl-1', accept.impl)
    expect(accept.calls[0].url).toBe('https://nucleos.test/api/cbam/goods-lines/gl-1/verify')

    const reject = fake()
    await rejectVerification('gl-1', 'Wrong installation.', reject.impl)
    expect(reject.calls[0].url).toBe('https://nucleos.test/api/cbam/goods-lines/gl-1/reject-verification')
    expect(JSON.parse(String(reject.calls[0].init.body))).toEqual({ reason: 'Wrong installation.' })
  })

  it('says the step is not allowed in this state, rather than that Nucleos is down', async () => {
    await expect(
      acceptVerification('gl-1', fake(409, { detail: 'bad transition' }).impl),
    ).rejects.toBeInstanceOf(VerificationRejectedError)
  })

  it('treats anything else as Nucleos being unavailable', async () => {
    await expect(requestVerification('gl-1', fake(503).impl)).rejects.toBeInstanceOf(NucleosUnavailableError)
  })
})
