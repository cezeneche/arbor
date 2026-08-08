import { execFileSync } from 'node:child_process'
import { verifyTimestampedBodyHmac } from '@/lib/webhooks/verify-signature'

// The script is the reference implementation a signing proxy copies, so what it
// produces must satisfy the route's own verifier. Asserting that directly is the
// only way to know the two have not drifted.
it('the signing script produces a signature the route accepts', () => {
  const out = execFileSync(
    'node',
    ['scripts/sign-inbound-email.mjs', '--url', 'http://unused', '--secret', 's3cr3t', '--print'],
    { encoding: 'utf8' },
  )
  const timestamp = out.match(/x-inbound-timestamp: (\d+)/)![1]
  const signature = out.match(/x-inbound-signature: ([a-f0-9]+)/)![1]
  const body = out.split('\n\n').slice(1).join('\n\n').replace(/\n$/, '')

  expect(verifyTimestampedBodyHmac(body, timestamp, signature, 's3cr3t')).toBe(true)
  expect(verifyTimestampedBodyHmac(body, timestamp, signature, 'wrong-secret')).toBe(false)
})
