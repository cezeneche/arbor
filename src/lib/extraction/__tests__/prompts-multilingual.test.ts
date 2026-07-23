import {
  buildExtractionPrompt,
  buildLanguageDetectionPrompt,
  buildQualityAssessmentPrompt,
} from '../prompts'

// Layer 1 multilingual + degraded-document handling.
// These are pure prompt-construction functions; no AI call is made here.

describe('buildExtractionPrompt — language awareness', () => {
  it('adds no translation instruction for English documents', () => {
    const prompt = buildExtractionPrompt('ELECTRICITY_BILL', ['total_consumption_kwh'], 'en')
    expect(prompt).not.toMatch(/written in/i)
  })

  it('adds no translation instruction when language is unknown or omitted', () => {
    const prompt = buildExtractionPrompt('ELECTRICITY_BILL', ['total_consumption_kwh'])
    expect(prompt).not.toMatch(/written in/i)
    const unknown = buildExtractionPrompt('ELECTRICITY_BILL', ['total_consumption_kwh'], 'unknown')
    expect(unknown).not.toMatch(/written in/i)
  })

  it('instructs not to translate values for a non-English document', () => {
    const prompt = buildExtractionPrompt('GAS_BILL', ['total_consumption_kwh'], 'de')
    expect(prompt).toMatch(/written in/i)
    expect(prompt).toMatch(/do not translate/i)
    // field names may be translated to English, values must not be
    expect(prompt).toMatch(/exactly as they appear/i)
  })
})

describe('buildLanguageDetectionPrompt', () => {
  it('asks for an ISO 639-1 code and nothing else', () => {
    const prompt = buildLanguageDetectionPrompt()
    expect(prompt).toMatch(/ISO 639-1/i)
    expect(prompt).toMatch(/code only/i)
  })
})

describe('buildQualityAssessmentPrompt', () => {
  it('asks for a 1-5 quality score returned as JSON', () => {
    const prompt = buildQualityAssessmentPrompt()
    expect(prompt).toMatch(/1 to 5/i)
    expect(prompt).toMatch(/quality/i)
    expect(prompt).toMatch(/JSON/i)
  })
})

describe('buildExtractionPrompt — relearning exemplar section', () => {
  it('is byte-for-byte unchanged when no exemplar section is supplied', () => {
    const withArg = buildExtractionPrompt('CUSTOMS_DECLARATION', ['declared_weight'], 'en', '')
    const withoutArg = buildExtractionPrompt('CUSTOMS_DECLARATION', ['declared_weight'], 'en')
    expect(withArg).toBe(withoutArg)
  })

  it('inserts the supplied exemplar section before the JSON structure', () => {
    const section = '\nAttention: read declared_weight with extra care.\n'
    const prompt = buildExtractionPrompt('CUSTOMS_DECLARATION', ['declared_weight'], 'en', section)
    expect(prompt).toContain('read declared_weight with extra care')
    expect(prompt.indexOf('extra care')).toBeLessThan(prompt.indexOf('Return this exact JSON'))
  })
})
