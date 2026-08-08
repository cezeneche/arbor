import {
  checkDestination,
  safeFetch,
  OutboundRequestError,
  type HostResolver,
  type PinnedFetch,
} from '../safe-fetch'

const PUBLIC_V4 = { address: '93.184.216.34', family: 4 as const }
const PUBLIC_V6 = { address: '2606:4700:4700::1111', family: 6 as const }
const METADATA = { address: '169.254.169.254', family: 4 as const }
const LOOPBACK = { address: '127.0.0.1', family: 4 as const }

const resolvesTo = (...addresses: Array<{ address: string; family: 4 | 6 }>): HostResolver =>
  async () => addresses

describe('checkDestination', () => {
  it('returns the resolved address the request will be pinned to', async () => {
    const result = await checkDestination('https://hooks.example.com/x', resolvesTo(PUBLIC_V4))
    expect(result.url.toString()).toBe('https://hooks.example.com/x')
    expect(result.pin).toEqual(PUBLIC_V4)
  })

  it('applies the URL rules before it ever resolves', async () => {
    const resolver = jest.fn(resolvesTo(PUBLIC_V4))
    await expect(checkDestination('http://example.com/x', resolver)).rejects.toMatchObject({
      reason: 'scheme',
    })
    expect(resolver).not.toHaveBeenCalled()
  })

  // The check is worth nothing if a hostname can answer with one public address
  // and one internal one — whichever we picked, the tenant chose the pair.
  it('rejects a hostname that resolves to any private address', async () => {
    await expect(
      checkDestination('https://sneaky.example.com/x', resolvesTo(PUBLIC_V4, METADATA)),
    ).rejects.toMatchObject({ reason: 'private_address' })
  })

  it('rejects a hostname resolving only to loopback', async () => {
    await expect(
      checkDestination('https://localhost-alias.example.com/', resolvesTo(LOOPBACK)),
    ).rejects.toMatchObject({ reason: 'private_address' })
  })

  it('rejects a hostname that resolves to nothing', async () => {
    await expect(checkDestination('https://gone.example.com/', resolvesTo())).rejects.toMatchObject({
      reason: 'blocked_host',
    })
  })

  it('rejects a hostname whose resolution fails', async () => {
    const failing: HostResolver = async () => {
      throw new Error('ENOTFOUND')
    }
    await expect(checkDestination('https://gone.example.com/', failing)).rejects.toMatchObject({
      reason: 'blocked_host',
    })
  })

  it('pins IPv6 with the right family', async () => {
    const result = await checkDestination('https://v6.example.com/', resolvesTo(PUBLIC_V6))
    expect(result.pin).toEqual(PUBLIC_V6)
  })

  // A literal has no DNS step to rebind, and net.connect dials it directly
  // without ever calling lookup.
  it('pins a public IPv4 literal without consulting DNS', async () => {
    const resolver = jest.fn(resolvesTo(PUBLIC_V4))
    const result = await checkDestination('https://93.184.216.34/x', resolver)
    expect(result.pin).toEqual({ address: '93.184.216.34', family: 4 })
    expect(resolver).not.toHaveBeenCalled()
  })

  it('pins a public IPv6 literal, stripping the URL brackets', async () => {
    const resolver = jest.fn(resolvesTo(PUBLIC_V4))
    const result = await checkDestination('https://[2606:4700:4700::1111]/x', resolver)
    expect(result.pin).toEqual({ address: '2606:4700:4700::1111', family: 6 })
    expect(resolver).not.toHaveBeenCalled()
  })

  it('still refuses a private literal', async () => {
    await expect(checkDestination('https://169.254.169.254/latest/')).rejects.toMatchObject({
      reason: 'private_address',
    })
  })
})

/** A transport that records what it was asked to do and replies from a script. */
function scriptedFetch(replies: Array<{ status: number; location?: string; body?: string }>) {
  const calls: Array<{ url: string; pin: string }> = []
  let i = 0
  const impl: PinnedFetch = async (url, init) => {
    calls.push({ url: url.toString(), pin: init.pin.address })
    const reply = replies[Math.min(i++, replies.length - 1)]
    return new Response(reply.body ?? '', {
      status: reply.status,
      headers: reply.location ? { location: reply.location } : {},
    }) as unknown as Awaited<ReturnType<PinnedFetch>>
  }
  return { impl, calls }
}

describe('safeFetch — resolution happens once per hop', () => {
  // The rebinding window existed because the address was resolved for the check
  // and then resolved again by the connection. safeFetch resolves once and hands
  // that address to the socket; a resolver that would answer differently the
  // second time never gets a second chance to.
  it('asks the resolver exactly once, and pins what it was told', async () => {
    let calls = 0
    const flipping: HostResolver = async () => {
      calls++
      // First answer public (passes the check), every later answer internal.
      return calls === 1 ? [PUBLIC_V4] : [METADATA]
    }
    const transport = scriptedFetch([{ status: 200, body: 'ok' }])

    const res = await safeFetch('https://rebinding.example.com/', {
      resolver: flipping,
      fetchImpl: transport.impl,
    })

    expect(calls).toBe(1)
    expect(res.pinnedAddress).toBe(PUBLIC_V4.address)
    expect(transport.calls[0].pin).toBe(PUBLIC_V4.address)
  })

  it('refuses before opening any socket when the resolution is private', async () => {
    const resolver = jest.fn(resolvesTo(METADATA))
    const transport = scriptedFetch([{ status: 200 }])

    await expect(
      safeFetch('https://sneaky.example.com/', { resolver, fetchImpl: transport.impl }),
    ).rejects.toBeInstanceOf(OutboundRequestError)

    expect(resolver).toHaveBeenCalledTimes(1)
    expect(transport.calls).toHaveLength(0)
  })

  it('refuses a blocked hostname without resolving at all', async () => {
    const resolver = jest.fn(resolvesTo(PUBLIC_V4))
    await expect(safeFetch('https://metadata.google.internal/', { resolver })).rejects.toMatchObject({
      reason: 'blocked_host',
    })
    expect(resolver).not.toHaveBeenCalled()
  })
})

describe('safeFetch — redirects are re-checked at every hop', () => {
  it('follows a redirect to another public host', async () => {
    const transport = scriptedFetch([
      { status: 302, location: 'https://elsewhere.example.com/final' },
      { status: 200, body: 'arrived' },
    ])
    const res = await safeFetch('https://start.example.com/', {
      resolver: resolvesTo(PUBLIC_V4),
      fetchImpl: transport.impl,
    })

    expect(res.text).toBe('arrived')
    expect(res.finalUrl).toBe('https://elsewhere.example.com/final')
    expect(transport.calls.map(c => c.url)).toEqual([
      'https://start.example.com/',
      'https://elsewhere.example.com/final',
    ])
  })

  // The destination after a 302 is the remote server's choice, not the tenant's,
  // so a check performed only on the first URL protects nothing.
  it('refuses a redirect into the metadata endpoint', async () => {
    const transport = scriptedFetch([
      { status: 302, location: 'https://169.254.169.254/latest/meta-data/' },
    ])
    await expect(
      safeFetch('https://start.example.com/', {
        resolver: resolvesTo(PUBLIC_V4),
        fetchImpl: transport.impl,
      }),
    ).rejects.toMatchObject({ reason: 'private_address' })
  })

  it('refuses a redirect that downgrades to http', async () => {
    const transport = scriptedFetch([{ status: 302, location: 'http://start.example.com/plain' }])
    await expect(
      safeFetch('https://start.example.com/', {
        resolver: resolvesTo(PUBLIC_V4),
        fetchImpl: transport.impl,
      }),
    ).rejects.toMatchObject({ reason: 'scheme' })
  })

  it('re-resolves each hop, so a host that turns private mid-chain is caught', async () => {
    let hop = 0
    const perHost: HostResolver = async hostname => {
      hop++
      return hostname === 'second.example.com' ? [METADATA] : [PUBLIC_V4]
    }
    const transport = scriptedFetch([
      { status: 302, location: 'https://second.example.com/x' },
      { status: 200, body: 'should never arrive' },
    ])

    await expect(
      safeFetch('https://first.example.com/', { resolver: perHost, fetchImpl: transport.impl }),
    ).rejects.toMatchObject({ reason: 'private_address' })
    expect(hop).toBe(2)
    expect(transport.calls).toHaveLength(1)
  })

  it('gives up rather than following a redirect loop for ever', async () => {
    const transport = scriptedFetch([{ status: 302, location: 'https://loop.example.com/again' }])
    await expect(
      safeFetch('https://loop.example.com/', {
        resolver: resolvesTo(PUBLIC_V4),
        fetchImpl: transport.impl,
        maxRedirects: 2,
      }),
    ).rejects.toMatchObject({ reason: 'too_many_redirects' })
    expect(transport.calls).toHaveLength(3)
  })
})

describe('safeFetch — response handling', () => {
  it('reports a non-2xx without throwing', async () => {
    const transport = scriptedFetch([{ status: 503, body: 'unavailable' }])
    const res = await safeFetch('https://x.example.com/', {
      resolver: resolvesTo(PUBLIC_V4),
      fetchImpl: transport.impl,
    })
    expect(res.ok).toBe(false)
    expect(res.status).toBe(503)
  })

  it('truncates a body past the cap rather than buffering it all', async () => {
    const transport = scriptedFetch([{ status: 200, body: 'x'.repeat(5000) }])
    const res = await safeFetch('https://x.example.com/', {
      resolver: resolvesTo(PUBLIC_V4),
      fetchImpl: transport.impl,
      maxBytes: 100,
    })
    expect(res.truncated).toBe(true)
    expect(res.text).toHaveLength(100)
  })
})
