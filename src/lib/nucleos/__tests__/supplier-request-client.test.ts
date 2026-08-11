import {
  createSupplierToken,
  SupplierRequestRejectedError,
} from '../supplier-request-client'
import { NucleosUnavailableError } from '../extraction-client'

// A permanent failure reported as an outage is the bug that cost us a day on the
// supplier form: the message said "try again shortly" for something that would
// never succeed, so nobody looked at the wiring. These two are the permanent
// ones — a goods line id the service will never accept, and a token that lacks
// the scope to create a request at all.

const ENV = process.env

beforeEach(() => {
  process.env = { ...ENV, NUCLEOS_URL: 'https://nucleos.test', NUCLEOS_INTERNAL_TOKEN: 't' }
})
afterEach(() => {
  process.env = ENV
})

const respond = (status: number, body: unknown = {}) =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch

describe('createSupplierToken', () => {
  it('returns the link on success', async () => {
    const result = await createSupplierToken(
      'abc',
      respond(201, { token: 'x', form_url: 'https://arbor/supplier/x', expires_at: '2026-09-01' }),
    )
    expect(result.form_url).toBe('https://arbor/supplier/x')
  })

  it('accepts 201, which is what the service actually returns', async () => {
    // The route is declared status_code=201. Treating only 200 as success would
    // fail every single real call.
    await expect(createSupplierToken('abc', respond(201, { form_url: 'u' }))).resolves.toBeDefined()
  })

  it('reports a rejected goods line as a rejection, not an outage', async () => {
    await expect(createSupplierToken('not-a-uuid', respond(422))).rejects.toBeInstanceOf(
      SupplierRequestRejectedError,
    )
  })

  it('reports a missing scope as a rejection, not an outage', async () => {
    // Retrying cannot add cbam:write to the token. Saying "try again shortly"
    // would send someone round a loop that never closes.
    await expect(createSupplierToken('abc', respond(403))).rejects.toBeInstanceOf(
      SupplierRequestRejectedError,
    )
  })

  it('names the missing scope, because that is the fix', async () => {
    await expect(createSupplierToken('abc', respond(403))).rejects.toThrow(/cbam:write/)
  })

  it('still reports a genuine outage as unavailable', async () => {
    await expect(createSupplierToken('abc', respond(503))).rejects.toBeInstanceOf(
      NucleosUnavailableError,
    )
  })

  it('treats an unauthenticated response as a configuration fault, not a rejection', async () => {
    // 401 means the token was not accepted at all — wrong or absent. That is
    // ours to fix, and it is not the user's goods line that is wrong.
    await expect(createSupplierToken('abc', respond(401))).rejects.toBeInstanceOf(
      NucleosUnavailableError,
    )
  })
})
