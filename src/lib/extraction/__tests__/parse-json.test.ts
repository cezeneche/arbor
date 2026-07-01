import { parseLooseJson } from '../parse-json'

// Layer 1 hardening. Claude usually returns bare JSON, but sometimes wraps it in
// a ```json fence or adds a sentence of preamble/trailer. Naive JSON.parse then
// throws "could not parse Claude response as JSON" and the whole extraction
// fails. parseLooseJson isolates the JSON payload so those benign wrappers don't
// sink a good extraction.

describe('parseLooseJson', () => {
  it('parses bare JSON', () => {
    expect(parseLooseJson('{"a":1}')).toEqual({ a: 1 })
  })

  it('strips a ```json fenced block', () => {
    expect(parseLooseJson('```json\n{"a":1}\n```')).toEqual({ a: 1 })
  })

  it('strips an unlabelled ``` fence', () => {
    expect(parseLooseJson('```\n{"a":1}\n```')).toEqual({ a: 1 })
  })

  it('tolerates a prose preamble', () => {
    expect(parseLooseJson('Here is the extracted data:\n{"a":1}')).toEqual({ a: 1 })
  })

  it('tolerates trailing prose', () => {
    expect(parseLooseJson('{"a":1}\n\nHope that helps!')).toEqual({ a: 1 })
  })

  it('handles nested objects when slicing to the outermost braces', () => {
    expect(parseLooseJson('prefix {"a":{"b":2},"c":[1,2]} suffix')).toEqual({ a: { b: 2 }, c: [1, 2] })
  })

  it('handles fenced JSON with surrounding prose', () => {
    expect(parseLooseJson('Sure:\n```json\n{"fields":[]}\n```\nDone.')).toEqual({ fields: [] })
  })

  it('parses a realistic extraction shape', () => {
    const raw = '```json\n{"documentTypeConfirmed":"ELECTRICITY_BILL","fields":[{"fieldName":"total_consumption_kwh","rawValue":"48250"}]}\n```'
    expect(parseLooseJson(raw)).toMatchObject({
      documentTypeConfirmed: 'ELECTRICITY_BILL',
      fields: [{ fieldName: 'total_consumption_kwh', rawValue: '48250' }],
    })
  })

  it('throws when there is no JSON at all', () => {
    expect(() => parseLooseJson('I could not read this document.')).toThrow()
  })
})
