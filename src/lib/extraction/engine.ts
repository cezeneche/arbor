import Anthropic from '@anthropic-ai/sdk'
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages'
import type { ExtractionInput, ExtractionResult } from './types'
import { EXTRACTION_SYSTEM_PROMPT, buildExtractionPrompt } from './prompts'
import { DOCUMENT_FIELD_DEFINITIONS } from './field-definitions'

// Lazily instantiated so importing this module (e.g. during `next build` page
// data collection) never requires ANTHROPIC_API_KEY to be present.
let _client: Anthropic | null = null
function getClient(): Anthropic {
  if (!_client) _client = new Anthropic()
  return _client
}

export async function extractDocument(input: ExtractionInput): Promise<ExtractionResult> {
  const fieldDefs = DOCUMENT_FIELD_DEFINITIONS[input.documentType] ?? []
  const requiredFields = fieldDefs.map((f) => f.name)
  const userPrompt = buildExtractionPrompt(input.documentType, requiredFields)

  // PDFs use type:'document'; images use type:'image'  -  distinct API content block types
  const documentBlock =
    input.mediaType === 'application/pdf'
      ? ({
          type: 'document' as const,
          source: {
            type: 'base64' as const,
            media_type: 'application/pdf' as const,
            data: input.documentBase64,
          },
        })
      : ({
          type: 'image' as const,
          source: {
            type: 'base64' as const,
            media_type: input.mediaType,
            data: input.documentBase64,
          },
        })

  const messages: MessageParam[] = [
    { role: 'user', content: [documentBlock, { type: 'text', text: userPrompt }] },
  ]

  const response = await getClient().messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    system: [
      {
        type: 'text',
        text: EXTRACTION_SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages,
  })

  const rawText = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('')

  try {
    const parsed = JSON.parse(rawText) as {
      documentTypeConfirmed?: string
      extractionNotes?: string
      fields?: ExtractionResult['fields']
    }
    return {
      success: true,
      fields: parsed.fields ?? [],
      documentTypeConfirmed: parsed.documentTypeConfirmed ?? input.documentType,
      extractionNotes: parsed.extractionNotes ?? '',
      rawResponse: rawText,
    }
  } catch {
    return {
      success: false,
      fields: [],
      documentTypeConfirmed: input.documentType,
      extractionNotes: 'Extraction failed : could not parse Claude response as JSON',
      rawResponse: rawText,
    }
  }
}
