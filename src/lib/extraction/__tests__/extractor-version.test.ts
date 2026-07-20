import {
  EXTRACTION_MODEL,
  PROMPT_VERSION,
  EXTRACTOR_VERSION,
  composeExtractorVersion,
} from '../extractor-version'

// Version stamping (MLOps guardrail). A single, deterministic identifier for
// "which extractor produced this" = model id + prompt version. Stamped on every
// extraction and carried onto every ground-truth label so a later accuracy
// regression is attributable to the exact model/prompt change that caused it.
// Pure: no DB, no network.

describe('composeExtractorVersion', () => {
  it('joins model id and prompt version into one deterministic identifier', () => {
    expect(composeExtractorVersion('claude-sonnet-4-6', 'v3')).toBe('claude-sonnet-4-6+v3')
  })

  it('changes when the model changes (so a model bump is attributable)', () => {
    const a = composeExtractorVersion('claude-sonnet-4-6', 'v1')
    const b = composeExtractorVersion('claude-opus-4-8', 'v1')
    expect(a).not.toBe(b)
  })

  it('changes when the prompt version changes (so a prompt edit is attributable)', () => {
    const a = composeExtractorVersion('claude-sonnet-4-6', 'v1')
    const b = composeExtractorVersion('claude-sonnet-4-6', 'v2')
    expect(a).not.toBe(b)
  })

  it('is stable for the same inputs (attribution must be reproducible)', () => {
    expect(composeExtractorVersion('m', 'p')).toBe(composeExtractorVersion('m', 'p'))
  })
})

describe('EXTRACTOR_VERSION', () => {
  it('is the composition of the live model id and prompt version', () => {
    expect(EXTRACTOR_VERSION).toBe(composeExtractorVersion(EXTRACTION_MODEL, PROMPT_VERSION))
  })

  it('carries the model id as a substring, so stamps are greppable by model', () => {
    expect(EXTRACTOR_VERSION.includes(EXTRACTION_MODEL)).toBe(true)
  })
})
