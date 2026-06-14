// Query interpreter — converts plain English questions to structured Layer 3 query params.
// Uses AI for natural language parsing only. Does not read from or write to the database.
// Sits in front of Layer 3 (Access and Sharing); is not part of the data pipeline.

import Anthropic from '@anthropic-ai/sdk'

export type QueryType = 'entity' | 'supply_chain' | 'gap' | 'historical'
export type DataDomain = 'ENERGY' | 'MATERIALS' | 'PRODUCTION' | 'LOGISTICS' | 'EMISSIONS' | 'AGRICULTURE' | 'WASTE_AND_WATER' | 'COMPLIANCE'
export type TrustTier = 'A' | 'B' | 'C'

export interface ParsedQuery {
  interpretation: string
  isCalculation: boolean
  calculationNote?: string
  queryType: QueryType
  domain?: DataDomain
  fieldName?: string
  periodStart?: string
  periodEnd?: string
  trustTier?: TrustTier
  supplierEntityId?: string
}

function buildSystemPrompt(todayIso: string): string {
  return `You are a query parameter extractor for arbor, a certified operational data repository for manufacturers and suppliers.

Your only job is to translate a plain English question into structured query parameters. You do NOT answer questions — you extract parameters.

DATABASE STRUCTURE:
- DOMAINS: ENERGY, MATERIALS, PRODUCTION, LOGISTICS, EMISSIONS, AGRICULTURE, WASTE_AND_WATER, COMPLIANCE
- TRUST_TIERS: A (Verified), B (Declared), C (Estimated)
- QUERY_TYPES: entity (user's own data), supply_chain (data from authorised suppliers), gap (missing data), historical (trends over time)

Respond ONLY with a valid JSON object — no markdown, no explanation, just the JSON:
{
  "interpretation": "One plain English sentence describing what records you are searching for",
  "isCalculation": boolean,
  "calculationNote": "string describing what calculation is needed — only include this key when isCalculation is true",
  "queryType": "entity" | "supply_chain" | "gap" | "historical",
  "domain": "ENERGY" | "MATERIALS" | "PRODUCTION" | "LOGISTICS" | "EMISSIONS" | "AGRICULTURE" | "WASTE_AND_WATER" | "COMPLIANCE" | null,
  "fieldName": "snake_case field name if a specific field is clearly mentioned, otherwise null",
  "periodStart": "YYYY-MM-DD or null",
  "periodEnd": "YYYY-MM-DD or null",
  "trustTier": "A" | "B" | "C" | null
}

isCalculation must be true when the question asks for: totals, sums, averages, combined figures, carbon intensity, ratios, percentages, or any derived metric.

PERIOD PARSING (today is ${todayIso}):
- Q1 = Jan 01 to Mar 31, Q2 = Apr 01 to Jun 30, Q3 = Jul 01 to Sep 30, Q4 = Oct 01 to Dec 31
- "last year" = previous calendar year
- "this year" = current calendar year start to Dec 31
- "last quarter" = the most recently completed quarter

QUERY TYPE RULES:
- "my data", "our records", "we", "I" → entity
- "supplier", "supply chain", "all suppliers", "vendor" → supply_chain
- "missing", "gaps", "not submitted", "what do we not have" → gap
- "trend", "over time", "quarter by quarter", "history", "how has X changed" → historical
- Default: entity

DOMAIN MAPPING:
- electricity, gas, fuel, energy consumption, kWh, MWh → ENERGY
- raw materials, steel, aluminium, intake, inputs → MATERIALS
- production output, manufacturing, batch, yield, tonnes produced → PRODUCTION
- freight, shipping, logistics, delivery, transport, carrier → LOGISTICS
- emissions, carbon, CO2, CO2e, GHG → EMISSIONS
- crops, agriculture, farm, fertiliser, harvest, yield (agricultural) → AGRICULTURE
- waste, water use, disposal, water consumption → WASTE_AND_WATER
- customs declaration, certificates, compliance, CBAM, regulatory → COMPLIANCE`
}

const client = new Anthropic()

export async function parseNlQuery(question: string): Promise<ParsedQuery> {
  const todayIso = new Date().toISOString().split('T')[0]

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    system: buildSystemPrompt(todayIso),
    messages: [{ role: 'user', content: question }],
  })

  const rawText = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('')
    .trim()

  const jsonMatch = rawText.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    throw new Error('Could not parse query parameters from the question. Please try rephrasing.')
  }

  return JSON.parse(jsonMatch[0]) as ParsedQuery
}
