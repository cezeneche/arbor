import { QUESTIONNAIRE_TEMPLATES, getTemplate, listTemplates } from '../templates'
import { isSupportedUnit } from '@/lib/layer3/unit-conversion'
import { DataDomain } from '@/lib/constants'

const DOMAINS = new Set(Object.values(DataDomain) as string[])

describe('questionnaire templates', () => {
  // Four of the five were empty stubs rendering "Coming soon" in the live
  // portal. A catalogue whose entries mostly cannot be used is worse than a
  // shorter catalogue: it advertises what the product does not do.
  it('every template is pre-fillable', () => {
    for (const t of QUESTIONNAIRE_TEMPLATES) {
      expect(t.status).toBe('available')
      expect(t.questions.length).toBeGreaterThan(0)
    }
  })

  it('template ids are unique', () => {
    const ids = QUESTIONNAIRE_TEMPLATES.map(t => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('question ids are unique within each template', () => {
    for (const t of QUESTIONNAIRE_TEMPLATES) {
      const ids = t.questions.map(q => q.id)
      expect(new Set(ids).size).toBe(ids.length)
    }
  })

  it('every question names one of the eight domains', () => {
    for (const t of QUESTIONNAIRE_TEMPLATES) {
      for (const q of t.questions) {
        expect(DOMAINS.has(q.domain)).toBe(true)
      }
    }
  })

  // A unit the conversion engine does not know cannot be produced from a stored
  // SI record, so the question would silently never fill.
  it('every direct or assemble question asks for a convertible unit', () => {
    for (const t of QUESTIONNAIRE_TEMPLATES) {
      for (const q of t.questions) {
        if (q.mode === 'collection') continue
        expect(q.unit).toBeDefined()
        expect(isSupportedUnit(q.unit as string)).toBe(true)
      }
    }
  })

  // Collection is the mode for "here are the records, your tool combines them".
  // Giving it a unit would imply Arbor had assembled a single figure.
  it('collection questions declare no unit', () => {
    for (const t of QUESTIONNAIRE_TEMPLATES) {
      for (const q of t.questions.filter(x => x.mode === 'collection')) {
        expect(q.unit).toBeUndefined()
      }
    }
  })

  it('every question has plain English text', () => {
    for (const t of QUESTIONNAIRE_TEMPLATES) {
      for (const q of t.questions) {
        expect(q.text.trim().length).toBeGreaterThan(0)
      }
    }
  })

  it('getTemplate finds every listed template and nothing else', () => {
    for (const t of QUESTIONNAIRE_TEMPLATES) {
      expect(getTemplate(t.id)?.id).toBe(t.id)
    }
    expect(getTemplate('not-a-template')).toBeUndefined()
  })

  it('the catalogue reports a real question count for each', () => {
    for (const summary of listTemplates()) {
      expect(summary.questionCount).toBeGreaterThan(0)
      expect(summary.status).toBe('available')
    }
  })
})
