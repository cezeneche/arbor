import { requireAuth } from '@/lib/auth-helpers'
import { ok } from '@/lib/api-helpers'
import { listTemplates } from '@/lib/questionnaires/templates'

// Layer 3 — read-only. Lists the questionnaire templates Arbor can pre-fill.
export async function GET() {
  const { session, response } = await requireAuth()
  if (!session) return response!
  return ok({ templates: listTemplates() })
}
