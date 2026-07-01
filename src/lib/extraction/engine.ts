import Anthropic from '@anthropic-ai/sdk'
import type { ContentBlockParam, MessageParam } from '@anthropic-ai/sdk/resources/messages'
import type {
  ExtractionInput,
  ExtractionResult,
  LanguageDetectionResult,
  QualityAssessmentResult,
} from './types'
import {
  EXTRACTION_SYSTEM_PROMPT,
  buildExtractionPrompt,
  buildLanguageDetectionPrompt,
  buildQualityAssessmentPrompt,
} from './prompts'
import { DOCUMENT_FIELD_DEFINITIONS } from './field-definitions'
import { parseLooseJson } from './parse-json'
import { collectFieldSamples, buildFusedFields } from './fusion'
import { fuseFields, type FusionInputField } from '@/lib/brain/fusion-client'
import { BrainUnavailableError } from '@/lib/brain/calibration-client'
import {
  isGenericExtraction,
  buildGenericExtractionPrompt,
  parseGenericExtractionResponse,
} from './generic'

// How many self-consistency samples to draw per document (Upgrade 1). k>1 turns
// on Bayesian fusion of the samples' agreement into an honest, varying
// confidence; k=1 keeps single-sample extraction (model self-reported score).
const EXTRACTION_SAMPLES = Math.max(1, Number(process.env.EXTRACTION_SAMPLES ?? 3))

// Lazily instantiated so importing this module (e.g. during `next build` page
// data collection) never requires ANTHROPIC_API_KEY to be present.
let _client: Anthropic | null = null
function getClient(): Anthropic {
  if (!_client) _client = new Anthropic()
  return _client
}

const EXTRACTION_MODEL = 'claude-sonnet-4-6'

// Build the document content block once — shared by all three Layer 1 calls.
function documentContentBlock(
  base64: string,
  mediaType: ExtractionInput['mediaType'],
): ContentBlockParam {
  return mediaType === 'application/pdf'
    ? {
        type: 'document' as const,
        source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: base64 },
      }
    : {
        type: 'image' as const,
        source: { type: 'base64' as const, media_type: mediaType, data: base64 },
      }
}

function textFromResponse(response: Anthropic.Message): string {
  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('')
}

// Gap 1 — cheap language-detection pre-call. Returns 'unknown' on any failure;
// language detection must never block the extraction pipeline.
export async function detectLanguage(
  base64: string,
  mediaType: ExtractionInput['mediaType'],
): Promise<LanguageDetectionResult> {
  try {
    const response = await getClient().messages.create({
      model: EXTRACTION_MODEL,
      max_tokens: 16,
      messages: [
        {
          role: 'user',
          content: [documentContentBlock(base64, mediaType), { type: 'text', text: buildLanguageDetectionPrompt() }],
        },
      ],
    })
    const raw = textFromResponse(response).trim().toLowerCase()
    // The prompt asks for the bare code, but tolerate trailing prose: take the
    // last isolated two-letter token (codes conventionally appear at the end).
    const tokens = raw.match(/\b[a-z]{2}\b/g)
    return { language: tokens && tokens.length > 0 ? tokens[tokens.length - 1] : 'unknown' }
  } catch {
    return { language: 'unknown' }
  }
}

// Gap 1 — image quality pre-call (images only; PDFs are vector/text and skip this).
// Returns quality 5 on any failure so a transient error never blocks a good document.
export async function assessImageQuality(
  base64: string,
  mediaType: ExtractionInput['mediaType'],
): Promise<QualityAssessmentResult> {
  if (mediaType === 'application/pdf') return { quality: 5, issues: [] }
  try {
    const response = await getClient().messages.create({
      model: EXTRACTION_MODEL,
      max_tokens: 128,
      messages: [
        {
          role: 'user',
          content: [documentContentBlock(base64, mediaType), { type: 'text', text: buildQualityAssessmentPrompt() }],
        },
      ],
    })
    const parsed = parseLooseJson(textFromResponse(response)) as Partial<QualityAssessmentResult>
    const quality = typeof parsed.quality === 'number' ? parsed.quality : 5
    return { quality, issues: Array.isArray(parsed.issues) ? parsed.issues : [] }
  } catch {
    return { quality: 5, issues: [] }
  }
}

/**
 * Upgrade 1 — extract with self-consistency. Draws k samples of the document at
 * the model's sampling temperature, then fuses per-field agreement into an
 * honest, *varying* confidence via the brain's Bayesian fusion. Fail-soft: if
 * the brain is unavailable, or only one sample succeeds, it degrades to a single
 * extraction (the model's self-reported score) rather than blocking ingestion.
 */
export async function extractDocumentWithConsistency(
  input: ExtractionInput,
  opts: { samples?: number } = {},
): Promise<ExtractionResult> {
  const k = Math.max(1, opts.samples ?? EXTRACTION_SAMPLES)
  if (k <= 1) return extractDocument(input)

  const settled = await Promise.allSettled(
    Array.from({ length: k }, () => extractDocument(input)),
  )
  const results = settled
    .filter((r): r is PromiseFulfilledResult<ExtractionResult> => r.status === 'fulfilled')
    .map(r => r.value)
  const successes = results.filter(r => r.success)

  if (successes.length === 0) {
    return (
      results[0] ?? {
        success: false,
        fields: [],
        documentTypeConfirmed: input.documentType,
        extractionNotes: 'Extraction failed : all samples failed',
        rawResponse: '',
        languageNote: null,
        documentClass: null,
      }
    )
  }
  if (successes.length === 1) return successes[0]

  const groups = collectFieldSamples(successes)
  try {
    const documentClass = successes[0].documentClass ?? input.documentType
    const payload: FusionInputField[] = groups.map(g => ({
      field_name: g.fieldName,
      document_class: documentClass,
      samples: g.samples,
    }))
    const fused = await fuseFields(payload)
    return { ...successes[0], fields: buildFusedFields(groups, fused) }
  } catch (err) {
    // Brain down → degrade to the first successful sample (never block ingestion).
    if (err instanceof BrainUnavailableError) return successes[0]
    throw err
  }
}

export async function extractDocument(input: ExtractionInput): Promise<ExtractionResult> {
  // Core 3 — schema-on-read path for documents with no admissibility spec.
  if (isGenericExtraction(input.documentType)) {
    return extractGenericDocument(input)
  }

  const fieldDefs = DOCUMENT_FIELD_DEFINITIONS[input.documentType] ?? []
  const requiredFields = fieldDefs.map((f) => f.name)
  const userPrompt = buildExtractionPrompt(input.documentType, requiredFields, input.detectedLanguage)

  const isForeign =
    !!input.detectedLanguage &&
    input.detectedLanguage !== 'en' &&
    input.detectedLanguage !== 'unknown'
  const languageNote = isForeign
    ? `This document appears to be in ${input.detectedLanguage}. Values have been extracted as written — check numeric fields and units carefully.`
    : null

  const messages: MessageParam[] = [
    {
      role: 'user',
      content: [documentContentBlock(input.documentBase64, input.mediaType), { type: 'text', text: userPrompt }],
    },
  ]

  const response = await getClient().messages.create({
    model: EXTRACTION_MODEL,
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

  const rawText = textFromResponse(response)

  try {
    const parsed = parseLooseJson(rawText) as {
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
      languageNote,
      documentClass: null,
    }
  } catch {
    return {
      success: false,
      fields: [],
      documentTypeConfirmed: input.documentType,
      extractionNotes: 'Extraction failed : could not parse Claude response as JSON',
      rawResponse: rawText,
      languageNote,
      documentClass: null,
    }
  }
}

// Core 3 — GENERIC extraction. No fixed field list: the model returns whatever
// labelled values it finds, plus a best-guess documentClass. Records produced from
// these fields default to Tier B (Declared) — there is no spec to verify against.
async function extractGenericDocument(input: ExtractionInput): Promise<ExtractionResult> {
  const isForeign =
    !!input.detectedLanguage && input.detectedLanguage !== 'en' && input.detectedLanguage !== 'unknown'
  const languageNote = isForeign
    ? `This document appears to be in ${input.detectedLanguage}. Values have been extracted as written — check numeric fields and units carefully.`
    : null

  const response = await getClient().messages.create({
    model: EXTRACTION_MODEL,
    max_tokens: 4096,
    system: [
      { type: 'text', text: EXTRACTION_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    ],
    messages: [
      {
        role: 'user',
        content: [
          documentContentBlock(input.documentBase64, input.mediaType),
          { type: 'text', text: buildGenericExtractionPrompt() },
        ],
      },
    ],
  })

  const rawText = textFromResponse(response)
  const parsed = parseGenericExtractionResponse(rawText)

  return {
    success: parsed.success,
    fields: parsed.fields,
    documentTypeConfirmed: parsed.documentClass ?? 'OTHER',
    extractionNotes: parsed.notes,
    rawResponse: rawText,
    languageNote,
    documentClass: parsed.documentClass,
  }
}
