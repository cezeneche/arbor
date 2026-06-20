import type { ExtractionInput } from '../types'

const mockCreate = jest.fn()

jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  })),
}))

import { detectLanguage, assessImageQuality, extractDocument } from '../engine'

const base64 = 'dGVzdA=='

describe('detectLanguage', () => {
  beforeEach(() => mockCreate.mockReset())

  it('returns the ISO code Claude reports', async () => {
    mockCreate.mockResolvedValueOnce({ content: [{ type: 'text', text: 'de' }] })
    const result = await detectLanguage(base64, 'application/pdf')
    expect(result.language).toBe('de')
  })

  it('extracts a two-letter code even with surrounding text', async () => {
    mockCreate.mockResolvedValueOnce({ content: [{ type: 'text', text: 'The language is: fr.' }] })
    const result = await detectLanguage(base64, 'image/png')
    expect(result.language).toBe('fr')
  })

  it('returns unknown when the call throws — never blocks the pipeline', async () => {
    mockCreate.mockRejectedValueOnce(new Error('API down'))
    const result = await detectLanguage(base64, 'application/pdf')
    expect(result.language).toBe('unknown')
  })
})

describe('assessImageQuality', () => {
  beforeEach(() => mockCreate.mockReset())

  it('skips the call for PDFs and returns top quality', async () => {
    const result = await assessImageQuality(base64, 'application/pdf')
    expect(result.quality).toBe(5)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('parses the quality JSON for images', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: '{ "quality": 2, "issues": ["blurry", "skewed"] }' }],
    })
    const result = await assessImageQuality(base64, 'image/jpeg')
    expect(result.quality).toBe(2)
    expect(result.issues).toEqual(['blurry', 'skewed'])
  })

  it('returns quality 5 on parse failure — a transient error never blocks a good doc', async () => {
    mockCreate.mockResolvedValueOnce({ content: [{ type: 'text', text: 'not json' }] })
    const result = await assessImageQuality(base64, 'image/png')
    expect(result.quality).toBe(5)
  })
})

describe('extractDocument — languageNote', () => {
  beforeEach(() => mockCreate.mockReset())

  const validJson = JSON.stringify({ documentTypeConfirmed: 'GAS_BILL', extractionNotes: '', fields: [] })

  it('sets languageNote for a non-English document', async () => {
    mockCreate.mockResolvedValueOnce({ content: [{ type: 'text', text: validJson }] })
    const input: ExtractionInput = {
      documentBase64: base64,
      mediaType: 'application/pdf',
      documentType: 'GAS_BILL',
      entityName: 'Acme',
      detectedLanguage: 'de',
    }
    const result = await extractDocument(input)
    expect(result.languageNote).toMatch(/de/)
  })

  it('leaves languageNote null for English', async () => {
    mockCreate.mockResolvedValueOnce({ content: [{ type: 'text', text: validJson }] })
    const input: ExtractionInput = {
      documentBase64: base64,
      mediaType: 'application/pdf',
      documentType: 'GAS_BILL',
      entityName: 'Acme',
      detectedLanguage: 'en',
    }
    const result = await extractDocument(input)
    expect(result.languageNote).toBeNull()
  })
})
