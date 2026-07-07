import { NextResponse } from 'next/server'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'

// Shared budget guard for the API-key / query surface. Keyed by entity so a single
// leaked key cannot enumerate the store at full speed. Returns a 429 response to
// return early, or null when the request is within budget.
export async function enforceBuyerApiLimit(entityId: string): Promise<NextResponse | null> {
  const { allowed } = await checkRateLimit(RATE_LIMITS.buyerApi, entityId)
  if (!allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Slow down and try again shortly.', code: 'RATE_LIMITED' },
      { status: 429 },
    )
  }
  return null
}
