import { Agent } from 'undici'
import type { LookupFunction } from 'node:net'

// Connection-level address pinning.
//
// Validating a hostname's addresses and then calling fetch() leaves a gap: the
// request resolves DNS again when it actually connects, and a record with a
// one-second TTL can answer differently the second time. That is DNS rebinding —
// the check passes against a public address and the socket opens to
// 169.254.169.254 anyway. Re-resolving faster, or caching, only narrows the gap.
//
// The gap closes by removing the second resolution entirely. undici's connector
// spreads its `connect` options into net.connect/tls.connect, so supplying a
// `lookup` that ignores DNS and returns the address we already checked means the
// socket can only go to that address.
//
// What this deliberately does NOT change is the hostname. undici derives
// `servername` from the request host, so TLS still presents the real name and
// still verifies the certificate against it. Pinning decides where the packets
// go; it does not weaken who we insist we are talking to.

export interface PinnedAddress {
  address: string
  family: 4 | 6
}

/** A lookup that answers with the pinned address whatever it is asked. */
export function pinnedLookup(pin: PinnedAddress): LookupFunction {
  return (_hostname, options, callback) => {
    // net.connect calls this with { all: false } by default, but the option is
    // caller-controlled, so both answer shapes are supported.
    if (options && typeof options === 'object' && 'all' in options && options.all) {
      callback(null, [{ address: pin.address, family: pin.family }])
      return
    }
    callback(null, pin.address, pin.family)
  }
}

/**
 * A dispatcher whose sockets can only reach `pin`.
 *
 * Deliberately one agent per request rather than a shared pool: an agent is
 * bound to a single address, so reusing one across hosts would send the second
 * host's traffic to the first host's address. The cost is losing keep-alive on
 * these calls, which is the right trade for outbound requests to destinations a
 * tenant chose — they are low-volume (a webhook delivery, an ERP pull), and
 * correctness here is worth more than a reused socket.
 *
 * Callers must close it when the response has been read.
 */
export function createPinnedAgent(pin: PinnedAddress): Agent {
  return new Agent({
    connect: { lookup: pinnedLookup(pin) },
  })
}
