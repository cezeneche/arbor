// The body of a document confirmation: what the reviewer confirmed.
import { z } from 'zod'

const fieldSchema = z.object({
  fieldName: z.string(),
  confirmedValue: z.string(),
  confirmedUnit: z.string().optional(),
  domain: z.enum([
    'ENERGY',
    'MATERIALS',
    'PRODUCTION',
    'LOGISTICS',
    'EMISSIONS',
    'AGRICULTURE',
    'WASTE_AND_WATER',
    'COMPLIANCE',
  ]),
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
  sourceText: z.string().optional(),
  confidenceScore: z.number().min(0).max(1).optional(),
})

// Confirmed values that are not measurements: an importer's EORI, a commodity
// code, a country of origin. They write no DataRecord — a record needs a value,
// a unit and a period, and none of these has any of the three — but the case a
// CBAM document produces cannot be assembled without them, and the reviewer's
// correction to one has to reach it. Reading them off the extraction instead
// would build the case from what the model read rather than what the human
// confirmed, which for a corrected EORI means filing under the wrong identity.
const contextSchema = z.object({
  fieldName: z.string(),
  confirmedValue: z.string(),
})

export const confirmRequestSchema = z.object({
  fields: z.array(fieldSchema).min(1),
  context: z.array(contextSchema).optional(),
  // Absent means the client has not been asked yet. When a confirm would
  // duplicate something already stored, the request is refused with the list so
  // the user can decide — the write path never picks for them.
  onDuplicate: z.enum(['replace', 'keep_both']).optional(),
})

export type ConfirmRequest = z.infer<typeof confirmRequestSchema>
export type ConfirmRequestField = ConfirmRequest['fields'][number]
