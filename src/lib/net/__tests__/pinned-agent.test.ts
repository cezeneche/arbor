import { createServer, type Server } from 'node:http'
import { AddressInfo } from 'node:net'
import { fetch as undiciFetch } from 'undici'
import { createPinnedAgent, pinnedLookup } from '../pinned-agent'

describe('pinnedLookup', () => {
  const pin = { address: '93.184.216.34', family: 4 as const }

  it('answers with the pinned address whatever hostname it is asked for', done => {
    pinnedLookup(pin)('anything.example', {}, (err, address, family) => {
      expect(err).toBeNull()
      expect(address).toBe('93.184.216.34')
      expect(family).toBe(4)
      done()
    })
  })

  it('answers the all:true form as a single-entry list', done => {
    pinnedLookup(pin)('anything.example', { all: true }, (err, addresses) => {
      expect(err).toBeNull()
      expect(addresses).toEqual([{ address: '93.184.216.34', family: 4 }])
      done()
    })
  })

  it('pins IPv6 with the right family', done => {
    pinnedLookup({ address: '2606:4700::1111', family: 6 })('x.example', {}, (_e, address, family) => {
      expect(address).toBe('2606:4700::1111')
      expect(family).toBe(6)
      done()
    })
  })
})

// The behaviour that actually matters: a request for a hostname that does not
// resolve at all still reaches the pinned address. If DNS were consulted, this
// could not connect — .invalid is reserved and never resolves. Reaching the
// server proves the socket used the pin and nothing else.
describe('createPinnedAgent — end to end', () => {
  let server: Server
  let port: number
  const seenHostHeaders: string[] = []

  beforeAll(done => {
    server = createServer((req, res) => {
      seenHostHeaders.push(req.headers.host ?? '')
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.end('reached the pinned address')
    })
    server.listen(0, '127.0.0.1', () => {
      port = (server.address() as AddressInfo).port
      done()
    })
  })

  afterAll(done => {
    server.close(() => done())
  })

  it('connects to the pinned address for a hostname that cannot resolve', async () => {
    const agent = createPinnedAgent({ address: '127.0.0.1', family: 4 })
    try {
      const res = await undiciFetch(`http://rebinding-target.invalid:${port}/`, { dispatcher: agent })
      expect(res.status).toBe(200)
      await expect(res.text()).resolves.toBe('reached the pinned address')
    } finally {
      await agent.close()
    }
  })

  it('keeps the original hostname on the wire, so TLS would still verify it', async () => {
    seenHostHeaders.length = 0
    const agent = createPinnedAgent({ address: '127.0.0.1', family: 4 })
    try {
      await undiciFetch(`http://rebinding-target.invalid:${port}/`, { dispatcher: agent })
    } finally {
      await agent.close()
    }
    // Pinning redirects the packets; it does not rewrite who we asked for. The
    // same property is what keeps certificate verification intact over https.
    expect(seenHostHeaders[0]).toBe(`rebinding-target.invalid:${port}`)
  })
})
