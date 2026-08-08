import { validateOutboundUrl, isPrivateIpv4, isPrivateIpv6, isPrivateAddress } from '../ssrf-guard'

describe('isPrivateIpv4', () => {
  it.each([
    ['10.0.0.1'],
    ['172.16.5.4'],
    ['172.31.255.255'],
    ['192.168.1.1'],
    ['127.0.0.1'],
    ['0.0.0.0'],
    ['169.254.169.254'], // the cloud metadata endpoint — the one that matters most
    ['100.64.0.1'],
    ['224.0.0.1'],
    ['255.255.255.255'],
  ])('treats %s as private', ip => {
    expect(isPrivateIpv4(ip)).toBe(true)
  })

  it.each([['8.8.8.8'], ['1.1.1.1'], ['172.32.0.1'], ['172.15.0.1'], ['93.184.216.34']])(
    'treats %s as public',
    ip => {
      expect(isPrivateIpv4(ip)).toBe(false)
    },
  )
})

describe('isPrivateIpv6', () => {
  it.each([['::1'], ['::'], ['fc00::1'], ['fd12:3456::1'], ['fe80::1'], ['ff02::1']])(
    'treats %s as private',
    ip => {
      expect(isPrivateIpv6(ip)).toBe(true)
    },
  )

  // An IPv4-mapped address is dialled as IPv4, so the embedded address decides.
  it('unwraps IPv4-mapped addresses', () => {
    expect(isPrivateIpv6('::ffff:169.254.169.254')).toBe(true)
    expect(isPrivateIpv6('::ffff:8.8.8.8')).toBe(false)
  })

  it('treats a global unicast address as public', () => {
    expect(isPrivateIpv6('2606:4700:4700::1111')).toBe(false)
  })
})

describe('isPrivateAddress', () => {
  it('does not classify hostnames — those are settled by DNS at fetch time', () => {
    expect(isPrivateAddress('example.com')).toBe(false)
  })
})

describe('validateOutboundUrl', () => {
  it('accepts an ordinary public https URL', () => {
    const result = validateOutboundUrl('https://hooks.example.com/arbor?x=1')
    expect(result.ok).toBe(true)
  })

  it('accepts a public https URL on a non-default port', () => {
    // Enterprise ERP endpoints legitimately sit on odd ports; the address, not the
    // port, is what decides reachability.
    expect(validateOutboundUrl('https://erp.example.com:44300/odata').ok).toBe(true)
  })

  it.each([
    ['not-a-url', 'not_a_url'],
    ['http://example.com/hook', 'scheme'],
    ['ftp://example.com/hook', 'scheme'],
    ['https://user:pw@example.com/hook', 'credentials'],
    ['https://localhost/hook', 'blocked_host'],
    ['https://build.local/hook', 'blocked_host'],
    ['https://svc.internal/hook', 'blocked_host'],
    ['https://metadata.google.internal/computeMetadata/v1/', 'blocked_host'],
    ['https://intranet/hook', 'blocked_host'],
    ['https://127.0.0.1/hook', 'private_address'],
    ['https://169.254.169.254/latest/meta-data/', 'private_address'],
    ['https://10.1.2.3:8080/hook', 'private_address'],
    ['https://[::1]/hook', 'private_address'],
    ['https://[fd00::1]/hook', 'private_address'],
  ])('rejects %s as %s', (raw, reason) => {
    const result = validateOutboundUrl(raw)
    expect(result).toEqual({ ok: false, reason })
  })

  it('rejects a trailing-dot form of a blocked host', () => {
    expect(validateOutboundUrl('https://localhost./hook')).toEqual({
      ok: false,
      reason: 'blocked_host',
    })
  })
})
