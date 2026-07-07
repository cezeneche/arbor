// Layer 1 (AI). Parses a free-text data-request email into a structured
// {domain, fields, period}. The actual matching against stored records is pure and
// lives in inbound-parse.ts; this module only does the probabilistic extraction.
import Anthropic from '@anthropic-ai/sdk'
import { parseRequestResponse, type ParsedRequest } from './inbound-parse'
import { ALL_DOMAINS } from '@/lib/constants'

let _client: Anthropic | null = null
function getClient(): Anthropic {
  if (!_client) _client = new Anthropic()
  return _client
}

const MODEL = 'claude-sonnet-4-6'

export async function parseDataRequestEmail(text: string): Promise<ParsedRequest | null> {
  const prompt = `A customer has emailed a data request to one of their suppliers. Work out which operational data they are asking for.

Return ONLY this JSON, no preamble and no markdown:
{
  "domain": one of ${ALL_DOMAINS.join(', ')} or null,
  "fields": ["snake_case stored field names, e.g. total_consumption_kwh, quantity_produced, total_co2e, quantity_m3"],
  "periodStart": "YYYY-MM-DD" or null,
  "periodEnd": "YYYY-MM-DD" or null
}

Only include fields the email actually asks for. If the period is given as a quarter or year, convert it to start/end dates.

Email:
${text}`

  try {
    const response = await getClient().messages.create({
      model: MODEL,
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    })
    const raw = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
    return parseRequestResponse(raw.trim())
  } catch {
    return null
  }
}
