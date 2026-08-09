import {
  extractDocumentText,
  selectTextAdapter,
  OcrVendorNotConfiguredError,
  MAX_TRANSCRIBED_PAGES,
} from '../document-text'

// Arbor owns document→text from Phase 2. Nucleos's contract carries text, and
// Arbor previously had none: it sent the document straight to the model and got
// fields back, never a transcription.
//
// The adapter seam exists because the OCR vendor is deliberately undecided. What
// must not vary with that decision is the truncation contract: any adapter that
// reads only part of a document sets `truncated` and says why, because a
// partially-read document produces fields indistinguishable from a complete read
// and the reviewer's confirmation is what sets the provenance tier.

describe('selectTextAdapter', () => {
  const ORIGINAL = { ...process.env }
  afterEach(() => {
    process.env = { ...ORIGINAL }
  })

  it('defaults to the model transcription adapter', () => {
    delete process.env.OCR_ADAPTER
    expect(selectTextAdapter()).toBe('transcribe')
  })

  it('honours an explicit adapter choice', () => {
    process.env.OCR_ADAPTER = 'textract'
    expect(selectTextAdapter()).toBe('textract')
  })

  it('rejects an unknown adapter rather than silently falling back', () => {
    // Falling back would mean a deployment believing it runs Textract while
    // quietly running something else.
    process.env.OCR_ADAPTER = 'nonsense'
    expect(() => selectTextAdapter()).toThrow(/nonsense/)
  })
})

describe('extractDocumentText', () => {
  const ORIGINAL = { ...process.env }
  afterEach(() => {
    process.env = { ...ORIGINAL }
  })

  function transcriber(pages: string[]) {
    return jest.fn().mockResolvedValue({ pages })
  }

  it('returns the full text and a page map', async () => {
    const result = await extractDocumentText('base64', 'application/pdf', {
      transcribeImpl: transcriber(['page one', 'page two']),
    })

    expect(result.text).toBe('page one\n\npage two')
    expect(result.pages).toEqual([
      { page_number: 1, text: 'page one' },
      { page_number: 2, text: 'page two' },
    ])
    expect(result.engine).toBe('transcribe')
  })

  it('is not truncated when the whole document was read', async () => {
    const result = await extractDocumentText('base64', 'application/pdf', {
      transcribeImpl: transcriber(['only page']),
    })
    expect(result.truncated).toBe(false)
    expect(result.truncationReason).toBeNull()
  })

  it('flags truncation and names what was cut', async () => {
    const pages = Array.from({ length: MAX_TRANSCRIBED_PAGES + 3 }, (_, i) => `page ${i + 1}`)
    const result = await extractDocumentText('base64', 'application/pdf', {
      transcribeImpl: transcriber(pages),
    })

    expect(result.truncated).toBe(true)
    expect(result.truncationReason).toContain(String(MAX_TRANSCRIBED_PAGES))
    expect(result.truncationReason).toContain(String(pages.length))
    expect(result.pages).toHaveLength(MAX_TRANSCRIBED_PAGES)
  })

  it('keeps the pages it did read when truncating', async () => {
    const pages = Array.from({ length: MAX_TRANSCRIBED_PAGES + 1 }, (_, i) => `page ${i + 1}`)
    const result = await extractDocumentText('base64', 'application/pdf', {
      transcribeImpl: transcriber(pages),
    })
    expect(result.pages[0].text).toBe('page 1')
    expect(result.text).toContain('page 1')
  })

  it('an empty transcription is not silently a successful read', async () => {
    await expect(
      extractDocumentText('base64', 'application/pdf', {
        transcribeImpl: transcriber([]),
      }),
    ).rejects.toThrow(/no text/i)
  })

  it('a whitespace-only transcription is treated the same', async () => {
    await expect(
      extractDocumentText('base64', 'application/pdf', {
        transcribeImpl: transcriber(['   ', '\n']),
      }),
    ).rejects.toThrow(/no text/i)
  })

  describe('vendor adapters', () => {
    it('textract fails loudly rather than pretending to work', async () => {
      process.env.OCR_ADAPTER = 'textract'
      await expect(
        extractDocumentText('base64', 'application/pdf', {}),
      ).rejects.toBeInstanceOf(OcrVendorNotConfiguredError)
    })

    it('document-ai fails loudly too', async () => {
      process.env.OCR_ADAPTER = 'document-ai'
      await expect(
        extractDocumentText('base64', 'application/pdf', {}),
      ).rejects.toBeInstanceOf(OcrVendorNotConfiguredError)
    })

    it('the error names the adapter and what is missing', async () => {
      process.env.OCR_ADAPTER = 'textract'
      await expect(extractDocumentText('base64', 'application/pdf', {})).rejects.toThrow(
        /textract/i,
      )
    })
  })
})
