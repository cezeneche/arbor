import { probeNucleos } from '../readiness-probe'

// Tells a Nucleos that is starting up apart from one that is down. A cold start
// takes longer than the probe waits; a refusal, an error answer or an unknown
// host is a real failure.

const answer = (status: number) =>
  jest.fn(async () => new Response('{}', { status })) as unknown as typeof fetch

describe('probeNucleos', () => {
  it('is fine when Nucleos answers', async () => {
    await expect(probeNucleos('https://n.test', { fetchImpl: answer(200) })).resolves.toEqual({ ok: true })
  })

  it('is down when Nucleos answers with an error', async () => {
    await expect(probeNucleos('https://n.test', { fetchImpl: answer(503) })).resolves.toEqual({
      ok: false,
      detail: 'Nucleos reported 503.',
    })
  })

  it('is down when Nucleos cannot be reached at all', async () => {
    const refused = jest.fn(async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch
    await expect(probeNucleos('https://n.test', { fetchImpl: refused })).resolves.toEqual({
      ok: false,
      detail: 'Nucleos did not answer.',
    })
  })

  it('is slow, not down, when it takes longer than the probe waits', async () => {
    const hangs = jest.fn(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) =>
          init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'TimeoutError'))),
        ),
    ) as unknown as typeof fetch
    await expect(probeNucleos('https://n.test', { fetchImpl: hangs, timeoutMs: 20 })).resolves.toEqual({
      ok: true,
      slow: true,
      detail: 'Nucleos did not answer within 0.02 s.',
    })
  })

  it('is down when it is not configured', async () => {
    await expect(probeNucleos(undefined)).resolves.toEqual({ ok: false, detail: 'NUCLEOS_URL is not set.' })
  })
})
