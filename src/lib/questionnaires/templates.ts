// Core 1 — Questionnaire templates.
// CDP Climate (core operational subset) is the first fully-mapped template; it
// draws on stored operational data (energy, emissions, water, waste, production).
// Other frameworks are stubbed so the catalogue is honest about what is wired up.
//
// fieldName/domain values mirror the extraction field definitions and the eight
// data domains. unit values are the human-facing output unit; the Layer-3 loader
// converts stored SI records into these before pre-fill runs.

import type { QuestionnaireTemplate } from './types'

const cdpClimate: QuestionnaireTemplate = {
  id: 'cdp-climate',
  name: 'CDP Climate Change',
  framework: 'CDP',
  description:
    'The operational data points a CDP Climate Change response draws on — energy, emissions, water and waste. Arbor assembles your stored records; the emission-factor calculations stay in your CDP tool.',
  status: 'available',
  questions: [
    {
      id: 'c6-1-scope1',
      section: 'C6 — Emissions data',
      text: 'What were your gross Scope 1 emissions?',
      mode: 'direct',
      domain: 'EMISSIONS',
      fieldName: 'scope_1_total',
      unit: 'tonnes_co2e',
      guidance: 'Taken from your most recent carbon footprint report, if one is stored.',
    },
    {
      id: 'c6-3-scope2',
      section: 'C6 — Emissions data',
      text: 'What were your gross Scope 2 emissions?',
      mode: 'direct',
      domain: 'EMISSIONS',
      fieldName: 'scope_2_total',
      unit: 'tonnes_co2e',
    },
    {
      id: 'c6-5-scope3',
      section: 'C6 — Emissions data',
      text: 'What were your gross Scope 3 emissions?',
      mode: 'direct',
      domain: 'EMISSIONS',
      fieldName: 'scope_3_total',
      unit: 'tonnes_co2e',
    },
    {
      id: 'c6-total-co2e',
      section: 'C6 — Emissions data',
      text: 'What were your total reported emissions for the period?',
      mode: 'direct',
      domain: 'EMISSIONS',
      fieldName: 'total_co2e',
      unit: 'tonnes_co2e',
      guidance: 'From a stored carbon footprint report or LCA document.',
    },
    {
      id: 'c8-2-energy',
      section: 'C8 — Energy',
      text: 'What was your total metered energy consumption for the period?',
      mode: 'assemble',
      domain: 'ENERGY',
      fieldName: 'total_consumption_kwh',
      unit: 'kwh',
      guidance: 'Assembled by summing your stored electricity and gas bills, in kWh.',
    },
    {
      id: 'c8-2-energy-records',
      section: 'C8 — Energy',
      text: 'Which energy records should feed your emissions calculation?',
      mode: 'collection',
      domain: 'ENERGY',
      fieldName: 'total_consumption_kwh',
      guidance:
        'Listed for your CDP tool to apply emission factors. Arbor does not convert energy into emissions.',
    },
    {
      id: 'w1-water',
      section: 'W1 — Water',
      text: 'What was your total water consumption for the period?',
      mode: 'assemble',
      domain: 'WASTE_AND_WATER',
      fieldName: 'quantity_m3',
      unit: 'm3',
      guidance: 'Assembled by summing your stored water-use records.',
    },
    {
      id: 'c6-waste',
      section: 'C6 — Waste',
      text: 'What was the total quantity of waste you handled?',
      mode: 'assemble',
      domain: 'WASTE_AND_WATER',
      fieldName: 'quantity',
      unit: 'tonnes',
      guidance: 'Assembled by summing your stored waste disposal records.',
    },
    {
      id: 'production-output',
      section: 'Operational context',
      text: 'What was your total production output for the period?',
      mode: 'assemble',
      domain: 'PRODUCTION',
      fieldName: 'quantity_produced',
      unit: 'tonnes',
      guidance: 'Used as an intensity denominator by many frameworks.',
    },
  ],
}

// Stubs — listed in the catalogue, not yet pre-fillable.
const stub = (id: string, name: string, framework: string, description: string): QuestionnaireTemplate => ({
  id,
  name,
  framework,
  description,
  status: 'stub',
  questions: [],
})

export const QUESTIONNAIRE_TEMPLATES: QuestionnaireTemplate[] = [
  cdpClimate,
  stub('ecovadis', 'EcoVadis', 'EcoVadis', 'Sustainability scorecard covering environment, labour, ethics and procurement.'),
  stub('sedex-smeta', 'Sedex SMETA', 'Sedex', 'Ethical trade audit data request — labour, health & safety, environment, business ethics.'),
  stub('b-corp', 'B Corp Impact Assessment', 'B Lab', 'Impact assessment across governance, workers, community, environment and customers.'),
  stub('generic-supplier', 'Generic supplier questionnaire', 'Generic', 'A catch-all template for ad-hoc buyer data requests.'),
]

export function getTemplate(id: string): QuestionnaireTemplate | undefined {
  return QUESTIONNAIRE_TEMPLATES.find((t) => t.id === id)
}

/** Lightweight catalogue entry for the list view / list API. */
export interface TemplateSummary {
  id: string
  name: string
  framework: string
  description: string
  status: 'available' | 'stub'
  questionCount: number
}

export function listTemplates(): TemplateSummary[] {
  return QUESTIONNAIRE_TEMPLATES.map((t) => ({
    id: t.id,
    name: t.name,
    framework: t.framework,
    description: t.description,
    status: t.status,
    questionCount: t.questions.length,
  }))
}
