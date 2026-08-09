import {
  extractCbamFields,
  isNucleosConfigured,
  NucleosExtractionError,
  NucleosUnavailableError,
} from '../extraction-client'
import type { CbamExtractionRequest, CbamExtractionResult } from '../contract'

// Unlike the brain clients, this one must fail closed. A degraded Nucleos call
// would put a document into Review looking like a clean read of a document that
// contained no CBAM data, and the reviewer would confirm the emptiness. Every
// test here exists to prove a failure surfaces rather than becoming an empty
// extraction.

const REQUEST: CbamExtractionRequest = {
  document_id: 'doc-1',
  document_type: 'COMMERCIAL_INVOICE',
  entity_id: 'ent-1',
  text: 'CN code: 72071111',
  jurisdiction: 'EU',
}

function okResult(overrides: Partial<CbamExtractionResult> = {}): CbamExtractionResult {
  return {
    document_id: 'doc-1',
    fields: [],
    flags: [],
    engine: { engine_version: '0.1.0' },
    ...overrides,
  } as CbamExtractionResult
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response
}

describe('extractCbamFields', () => {
  const ORIGINAL = { ...process.env }

  beforeEach(() => {
    process.env.NUCLEOS_URL = 'https://nucleos.test'
    process.env.NUCLEOS_INTERNAL_TOKEN = 'token'
  })

  afterEach(() => {
    process.env = { ...ORIGINAL }
  })

  it('returns the parsed result on success', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(okResult()))
    const result = await extractCbamFields(REQUEST, { fetchImpl: fetchImpl as never })
    expect(result.document_id).toBe('doc-1')
  })

  it('sends the request to the internal extraction endpoint with the token', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(okResult()))
    await extractCbamFields(REQUEST, { fetchImpl: fetchImpl as never })

    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://nucleos.test/api/internal/cbam/extract')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer token')
    expect(JSON.parse(init.body as string).document_id).toBe('doc-1')
  })

  it('throws rather than degrading when Nucleos is not configured', async () => {
    delete process.env.NUCLEOS_URL
    await expect(extractCbamFields(REQUEST)).rejects.toBeInstanceOf(NucleosUnavailableError)
  })

  it('throws on a non-2xx response', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({ detail: 'bad' }, 422))
    await expect(
      extractCbamFields(REQUEST, { fetchImpl: fetchImpl as never }),
    ).rejects.toBeInstanceOf(NucleosExtractionError)
  })

  it('throws on a network error', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'))
    await expect(
      extractCbamFields(REQUEST, { fetchImpl: fetchImpl as never }),
    ).rejects.toBeInstanceOf(NucleosUnavailableError)
  })

  it('throws on timeout', async () => {
    const abortErr = Object.assign(new Error('aborted'), { name: 'AbortError' })
    const fetchImpl = jest.fn().mockRejectedValue(abortErr)
    await expect(
      extractCbamFields(REQUEST, { fetchImpl: fetchImpl as never }),
    ).rejects.toBeInstanceOf(NucleosUnavailableError)
  })

  it('rejects a result for a different document', async () => {
    // Would attach one document's fields to another's review screen, and both
    // screens would look entirely normal.
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(jsonResponse(okResult({ document_id: 'doc-OTHER' })))
    await expect(
      extractCbamFields(REQUEST, { fetchImpl: fetchImpl as never }),
    ).rejects.toThrow(/document_id/)
  })

  it('rejects a result with no engine version', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(jsonResponse({ ...okResult(), engine: {} }))
    await expect(
      extractCbamFields(REQUEST, { fetchImpl: fetchImpl as never }),
    ).rejects.toThrow(/engine version/)
  })

  it('never resolves to an empty result when the call failed', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error('boom'))
    const outcome = await extractCbamFields(REQUEST, { fetchImpl: fetchImpl as never })
      .then(() => 'resolved')
      .catch(() => 'threw')
    expect(outcome).toBe('threw')
  })
})

describe('isNucleosConfigured', () => {
  const ORIGINAL = { ...process.env }
  afterEach(() => {
    process.env = { ...ORIGINAL }
  })

  it('needs both the URL and the token', () => {
    process.env.NUCLEOS_URL = 'https://nucleos.test'
    delete process.env.NUCLEOS_INTERNAL_TOKEN
    expect(isNucleosConfigured()).toBe(false)

    process.env.NUCLEOS_INTERNAL_TOKEN = 'token'
    expect(isNucleosConfigured()).toBe(true)
  })
})
