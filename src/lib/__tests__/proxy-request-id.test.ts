import { NextRequest } from 'next/server'

// E6: the proxy gives every request one ID, passes it to the route (which reads
// it through currentRequestId and sends it on to Nucleos) and returns it to the
// browser, including on redirects and refusals.

jest.mock('next-auth', () => () => ({
  auth: (callback: (req: unknown) => unknown) => callback,
}))
jest.mock('@/lib/auth.config', () => ({ authConfig: {} }))
import proxy from '../../proxy'

type Handler = (req: NextRequest & { auth: unknown }) => Response | undefined
const run = (path: string, headers: Record<string, string> = {}, auth: unknown = null) => {
  const req = Object.assign(new NextRequest(`https://arbor.test${path}`, { headers }), { auth })
  return (proxy as unknown as Handler)(req)!
}

const UUID = /^[0-9a-f-]{36}$/

it('returns a new ID and hands it to the route', () => {
  const res = run('/login')
  const id = res.headers.get('x-request-id')!
  expect(id).toMatch(UUID)
  // How NextResponse.next passes an overridden request header to the route.
  expect(res.headers.get('x-middleware-request-x-request-id')).toBe(id)
})

it('keeps an ID the caller sent', () => {
  const res = run('/login', { 'x-request-id': 'req_from_caller_42' })
  expect(res.headers.get('x-request-id')).toBe('req_from_caller_42')
})

it('replaces an ID that is not plainly an ID', () => {
  expect(run('/login', { 'x-request-id': 'bad id!' }).headers.get('x-request-id')).toMatch(UUID)
})

it('puts the ID on a refusal too', () => {
  const res = run('/api/records')
  expect(res.status).toBe(401)
  expect(res.headers.get('x-request-id')).toMatch(UUID)
})
