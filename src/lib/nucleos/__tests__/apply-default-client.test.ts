// Asking Nucleos to record the published default on a goods line.

process.env.NUCLEOS_URL = 'https://nucleos.test'
process.env.NUCLEOS_INTERNAL_TOKEN = 'test-token'

jest.mock('../service-auth', () => ({
  nucleosHeaders: async (extra: Record<string, string> = {}) => ({ authorization: 'Bearer t', ...extra }),
}))

import {
  applyPublishedDefault,
  DefaultAlreadyRecordedError,
  NoPublishedDefaultError,
} from '../apply-default-client'
import { NucleosUnavailableError } from '../extraction-client'

function respond(status: number, body: unknown) {
  return jest.fn(async () => new Response(JSON.stringify(body), { status }))
}

describe('applyPublishedDefault', () => {
  // Expected: method default, version 1, the line's route, and the refusal flag.
  // Reason: without require_default_factor Nucleos records zero when no default
  // exists, which would understate the return.
  it('asks for the default, and a refusal rather than a zero', async () => {
    const fetchImpl = respond(201, { id: 'em-1' })
    await applyPublishedDefault('gl-1', 'BF-BOF', fetchImpl)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://nucleos.test/api/cbam/emissions')
    expect(JSON.parse(String(init.body))).toEqual({
      goods_line_id: 'gl-1',
      calculation_method: 'default',
      version: 1,
      production_route: 'BF-BOF',
      require_default_factor: true,
    })
  })

  it('says when the line already has a figure', async () => {
    await expect(
      applyPublishedDefault('gl-1', null, respond(409, { detail: { error: 'version_exists' } })),
    ).rejects.toBeInstanceOf(DefaultAlreadyRecordedError)
  })

  it('says when no default is published for the goods', async () => {
    await expect(
      applyPublishedDefault('gl-1', null, respond(422, { detail: { error: 'no_published_default' } })),
    ).rejects.toBeInstanceOf(NoPublishedDefaultError)
  })

  it('treats anything else as Nucleos being unavailable', async () => {
    await expect(applyPublishedDefault('gl-1', null, respond(500, {}))).rejects.toBeInstanceOf(
      NucleosUnavailableError,
    )
  })
})
