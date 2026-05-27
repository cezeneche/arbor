import type { ExtractionInput } from '../types'

const mockCreate = jest.fn()

jest.mock('@anthropic-ai/sdk', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      messages: { create: mockCreate },
    })),
  }
})

// Import after mock is set up
import { extractDocument } from '../engine'

function validExtractionJson(): string {
  return JSON.stringify({
    documentTypeConfirmed: 'ELECTRICITY_BILL',
    extractionNotes: 'Clear, well-formatted bill',
    fields: [
      {
        fieldName: 'account_holder_name',
        rawValue: 'Acme Ltd',
        rawUnit: null,
        sourceText: 'Account holder: Acme Ltd',
        confidenceScore: 0.97,
        flagged: false,
        flagReason: null,
      },
      {
        fieldName: 'total_consumption_kwh',
        rawValue: '150000',
        rawUnit: 'kWh',
        sourceText: 'Total units used: 150,000 kWh',
        confidenceScore: 0.95,
        flagged: false,
        flagReason: null,
      },
    ],
  })
}

const pdfInput: ExtractionInput = {
  documentBase64: 'dGVzdA==',
  mediaType: 'application/pdf',
  documentType: 'ELECTRICITY_BILL',
  entityName: 'Acme Ltd',
}

const jpegInput: ExtractionInput = {
  ...pdfInput,
  mediaType: 'image/jpeg',
}

describe('extractDocument', () => {
  beforeEach(() => {
    mockCreate.mockReset()
  })

  it('returns success:true with fields when Claude returns valid JSON', async () => {
    mockCreate.mockResolvedValueOnce({ content: [{ type: 'text', text: validExtractionJson() }] })

    const result = await extractDocument(pdfInput)

    expect(result.success).toBe(true)
    expect(result.fields).toHaveLength(2)
    expect(result.fields[0].fieldName).toBe('account_holder_name')
    expect(result.fields[0].confidenceScore).toBe(0.97)
    expect(result.fields[0].sourceText).toBe('Account holder: Acme Ltd')
  })

  it('uses type:document content block for PDF input', async () => {
    mockCreate.mockResolvedValueOnce({ content: [{ type: 'text', text: validExtractionJson() }] })

    await extractDocument(pdfInput)

    const callArgs = mockCreate.mock.calls[0][0]
    const docBlock = callArgs.messages[0].content[0]
    expect(docBlock.type).toBe('document')
    expect(docBlock.source.media_type).toBe('application/pdf')
  })

  it('uses type:image content block for JPEG input', async () => {
    mockCreate.mockResolvedValueOnce({ content: [{ type: 'text', text: validExtractionJson() }] })

    await extractDocument(jpegInput)

    const callArgs = mockCreate.mock.calls[0][0]
    const docBlock = callArgs.messages[0].content[0]
    expect(docBlock.type).toBe('image')
    expect(docBlock.source.media_type).toBe('image/jpeg')
  })

  it('returns success:false when Claude response is not valid JSON', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'Sorry, I cannot process this document.' }],
    })

    const result = await extractDocument(pdfInput)

    expect(result.success).toBe(false)
    expect(result.fields).toHaveLength(0)
    expect(result.extractionNotes).toContain('could not parse')
  })

  it('includes prompt caching cache_control on system prompt', async () => {
    mockCreate.mockResolvedValueOnce({ content: [{ type: 'text', text: validExtractionJson() }] })

    await extractDocument(pdfInput)

    const callArgs = mockCreate.mock.calls[0][0]
    const systemBlock = callArgs.system[0]
    expect(systemBlock.cache_control).toEqual({ type: 'ephemeral' })
  })
})
