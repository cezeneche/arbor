import { ok } from '@/lib/api-helpers'
import { SUPPORTED_UNITS } from '@/lib/layer3/unit-conversion'

// Layer 3 — lists the units the conversion engine accepts, grouped by SI base
// dimension. Referenced by the error message on /api/records/convert. Static
// vocabulary, so no auth and no data access.
export function GET() {
  return ok({ dimensions: SUPPORTED_UNITS })
}
