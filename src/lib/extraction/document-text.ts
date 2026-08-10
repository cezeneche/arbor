// Document → text. Arbor owns this from Phase 2.
//
// Arbor never needed a transcription before: it sends the document to the model
// and gets structured fields back in one step. Nucleos's contract carries text,
// so the CBAM path needs the intermediate representation Arbor had skipped.
//
// The OCR vendor is deliberately undecided, so this is an adapter seam. What must
// not vary with that decision is the truncation contract: any adapter that reads
// only part of a document sets `truncated` and says why. A partially-read
// document produces fields indistinguishable from a complete read, and the
// reviewer's confirmation is what sets the provenance tier — so silent
// truncation manufactures a VERIFIED record from a document nobody read in full.

import Anthropic from '@anthropic-ai/sdk'
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages'
import type { ExtractionInput } from './types'
import { EXTRACTION_MODEL } from './extractor-version'

export type TextAdapter = 'transcribe' | 'textract' | 'document-ai'

const ADAPTERS: readonly TextAdapter[] = ['transcribe', 'textract', 'document-ai'] as const

/**
 * Pages read in one transcription pass.
 *
 * A cap is necessary — an unbounded document would blow the context window and
 * fail outright — but unlike the 3-page cap this replaces, exceeding it is
 * recorded rather than passed off as a complete read.
 */
export const MAX_TRANSCRIBED_PAGES = 30

export class OcrVendorNotConfiguredError extends Error {
  constructor(adapter: TextAdapter, missing: string) {
    super(
      `OCR adapter "${adapter}" is selected but not configured: ${missing}. ` +
        `Set OCR_ADAPTER=transcribe to use model transcription instead.`,
    )
    this.name = 'OcrVendorNotConfiguredError'
  }
}

export class EmptyTranscriptionError extends Error {
  constructor() {
    super(
      'Document transcription produced no text. Treated as a failure rather than ' +
        'an empty document: the two are indistinguishable downstream, and a reviewer ' +
        'would confirm the second while looking at the first.',
    )
    this.name = 'EmptyTranscriptionError'
  }
}

export interface DocumentPage {
  page_number: number
  text: string
}

export interface DocumentText {
  text: string
  pages: DocumentPage[]
  truncated: boolean
  truncationReason: string | null
  engine: TextAdapter
  meanConfidence: number | null
}

export function selectTextAdapter(): TextAdapter {
  const configured = (process.env.OCR_ADAPTER ?? 'transcribe').trim() as TextAdapter
  if (!ADAPTERS.includes(configured)) {
    throw new Error(
      `Unknown OCR_ADAPTER "${configured}". Expected one of: ${ADAPTERS.join(', ')}.`,
    )
  }
  return configured
}

export interface TranscriptionResult {
  pages: string[]
  meanConfidence?: number | null
}

export interface ExtractDocumentTextOptions {
  /** Injectable transcriber, for hermetic tests. */
  transcribeImpl?: (
    base64: string,
    mediaType: ExtractionInput['mediaType'],
  ) => Promise<TranscriptionResult>
  adapter?: TextAdapter
}

let _client: Anthropic | null = null
function getClient(): Anthropic {
  if (!_client) _client = new Anthropic()
  return _client
}

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

const TRANSCRIPTION_PROMPT =
  'Transcribe this document to plain text, page by page.\n\n' +
  'Rules:\n' +
  '- Reproduce the text exactly as written. Do not summarise, correct or reformat.\n' +
  '- Preserve numbers, codes and units character for character, including thousand ' +
  'separators and decimal marks exactly as they appear.\n' +
  '- Keep table rows on one line, with cells separated by " | ".\n' +
  '- Separate each page with a line containing only "--- PAGE BREAK ---".\n' +
  '- Output only the transcription. No commentary, no markdown fences.'

async function transcribeWithModel(
  base64: string,
  mediaType: ExtractionInput['mediaType'],
): Promise<TranscriptionResult> {
  const response = await getClient().messages.create({
    model: EXTRACTION_MODEL,
    max_tokens: 8192,
    messages: [
      {
        role: 'user',
        content: [documentContentBlock(base64, mediaType), { type: 'text', text: TRANSCRIPTION_PROMPT }],
      },
    ],
  })

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('')

  return { pages: text.split(/^---\s*PAGE BREAK\s*---$/m).map((p) => p.trim()) }
}

export async function extractDocumentText(
  base64: string,
  mediaType: ExtractionInput['mediaType'],
  opts: ExtractDocumentTextOptions = {},
): Promise<DocumentText> {
  const adapter = opts.adapter ?? selectTextAdapter()

  if (adapter === 'textract') {
    throw new OcrVendorNotConfiguredError(
      'textract',
      'AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY and AWS_REGION are required, and the ' +
        'Textract adapter has not been implemented',
    )
  }
  if (adapter === 'document-ai') {
    throw new OcrVendorNotConfiguredError(
      'document-ai',
      'GOOGLE_APPLICATION_CREDENTIALS and a Document AI processor ID are required, and ' +
        'the Document AI adapter has not been implemented',
    )
  }

  const transcribe = opts.transcribeImpl ?? transcribeWithModel
  const result = await transcribe(base64, mediaType)

  const allPages = (result.pages ?? []).map((p) => (p ?? '').trim())
  const nonEmpty = allPages.filter((p) => p.length > 0)
  if (nonEmpty.length === 0) {
    throw new EmptyTranscriptionError()
  }

  const truncated = nonEmpty.length > MAX_TRANSCRIBED_PAGES
  const kept = truncated ? nonEmpty.slice(0, MAX_TRANSCRIBED_PAGES) : nonEmpty

  return {
    text: kept.join('\n\n'),
    pages: kept.map((text, i) => ({ page_number: i + 1, text })),
    truncated,
    truncationReason: truncated
      ? `Only the first ${MAX_TRANSCRIBED_PAGES} of ${nonEmpty.length} pages were read`
      : null,
    engine: adapter,
    meanConfidence: result.meanConfidence ?? null,
  }
}
