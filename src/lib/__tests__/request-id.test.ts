import { acceptRequestId, currentRequestId, REQUEST_ID_HEADER } from '../request-id'

// E6: every request carries one ID, from the proxy through Arbor's logs to
// Nucleos (which logs X-Request-Id), so one action can be followed end to end.
// An ID a caller sends is kept only if it is plainly an ID: it is echoed into
// logs and response headers, so anything else is replaced.

const headerStore: { value: string | null } = { value: null }
jest.mock('next/headers', () => ({
  headers: async () => ({ get: (name: string) => (name === 'x-request-id' ? headerStore.value : null) }),
}))

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

it('names the header Nucleos already reads', () => {
  expect(REQUEST_ID_HEADER).toBe('x-request-id')
})

it('keeps an ID the caller sent', () => {
  expect(acceptRequestId('c0ffee00-1234-4abc-8def-0123456789ab')).toBe('c0ffee00-1234-4abc-8def-0123456789ab')
  expect(acceptRequestId('req_01HXYZabc123')).toBe('req_01HXYZabc123')
})

it('makes a new one when none was sent', () => {
  expect(acceptRequestId(null)).toMatch(UUID)
})

it('replaces anything that is not plainly an ID', () => {
  for (const bad of [
    '',
    'short',
    'has space in it',
    'line\nbreak-injected-id',
    'x'.repeat(129),
    '<script>id</script>',
  ]) {
    expect(acceptRequestId(bad)).toMatch(UUID)
  }
})

it('reads the current request’s ID inside a request', async () => {
  headerStore.value = 'req_from_proxy_123'
  expect(await currentRequestId()).toBe('req_from_proxy_123')
})

it('makes one up outside a request rather than failing', async () => {
  headerStore.value = null
  expect(await currentRequestId()).toMatch(UUID)
})
