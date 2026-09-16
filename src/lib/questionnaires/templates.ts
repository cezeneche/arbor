// Questionnaire templates.
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

// The other four templates.
//
// Each covers the OPERATIONAL subset of its framework and says so. EcoVadis,
// SMETA and B Corp are mostly policy questions — is there a written grievance
// procedure, who sits on the board — and Arbor holds no answer to any of them.
// It holds metered, document-backed operational figures, so those are the
// questions here.
//
// That boundary is the honest one and it is also the useful one: the
// operational figures are the part a supplier currently rebuilds from
// spreadsheets every time, and the policy answers are the part they can write
// once and reuse. Listing a policy question here with a permanent gap beside it
// would make the response look less complete than it is.

const ecovadis: QuestionnaireTemplate = {
  id: 'ecovadis',
  name: 'EcoVadis',
  framework: 'EcoVadis',
  description:
    'The Environment-theme figures an EcoVadis scorecard asks for — energy, water, waste and emissions. The policy and management-system questions are answered in EcoVadis itself; Arbor fills the measured ones.',
  status: 'available',
  questions: [
    {
      id: 'env-energy',
      section: 'Environment — Energy',
      text: 'How much energy did your sites use in the reporting period?',
      mode: 'assemble',
      domain: 'ENERGY',
      fieldName: 'total_consumption_kwh',
      unit: 'kwh',
      guidance: 'Assembled by summing your stored electricity and gas bills.',
    },
    {
      id: 'env-energy-records',
      section: 'Environment — Energy',
      text: 'Which energy records support that figure?',
      mode: 'collection',
      domain: 'ENERGY',
      fieldName: 'total_consumption_kwh',
      guidance:
        'Listed so your scorecard can apply its own emission factors. Arbor does not convert energy into emissions.',
    },
    {
      id: 'env-water',
      section: 'Environment — Water',
      text: 'How much water did you use?',
      mode: 'assemble',
      domain: 'WASTE_AND_WATER',
      fieldName: 'quantity_m3',
      unit: 'm3',
    },
    {
      id: 'env-waste',
      section: 'Environment — Waste',
      text: 'How much waste did you send for disposal or recovery?',
      mode: 'assemble',
      domain: 'WASTE_AND_WATER',
      fieldName: 'quantity',
      unit: 'tonnes',
    },
    {
      id: 'env-ghg-total',
      section: 'Environment — Emissions',
      text: 'What total emissions have you reported?',
      mode: 'direct',
      domain: 'EMISSIONS',
      fieldName: 'total_co2e',
      unit: 'tonnes_co2e',
      guidance: 'From a stored carbon footprint report, if you have one.',
    },
    {
      id: 'env-production',
      section: 'Environment — Intensity',
      text: 'How much did you produce in the period?',
      mode: 'assemble',
      domain: 'PRODUCTION',
      fieldName: 'quantity_produced',
      unit: 'tonnes',
      guidance: 'EcoVadis normalises several environment figures by output.',
    },
  ],
}

const sedexSmeta: QuestionnaireTemplate = {
  id: 'sedex-smeta',
  name: 'Sedex SMETA',
  framework: 'Sedex',
  description:
    'The environment pillar of a SMETA 4-pillar audit — the measured site figures an auditor asks to see evidence for. Labour, health & safety and business ethics are answered in Sedex; Arbor fills the measured ones and points at the documents behind them.',
  status: 'available',
  questions: [
    {
      id: 'smeta-energy',
      section: 'Environment — Energy use',
      text: 'What was the site’s energy consumption for the period?',
      mode: 'assemble',
      domain: 'ENERGY',
      fieldName: 'total_consumption_kwh',
      unit: 'kwh',
      guidance: 'An auditor will ask for the bills behind this. They are attached to each record.',
    },
    {
      id: 'smeta-water',
      section: 'Environment — Water',
      text: 'What was the site’s water consumption?',
      mode: 'assemble',
      domain: 'WASTE_AND_WATER',
      fieldName: 'quantity_m3',
      unit: 'm3',
    },
    {
      id: 'smeta-waste',
      section: 'Environment — Waste',
      text: 'How much waste was transferred off site?',
      mode: 'assemble',
      domain: 'WASTE_AND_WATER',
      fieldName: 'quantity',
      unit: 'tonnes',
      guidance: 'Backed by your waste transfer notes, including the carrier licence on each.',
    },
    {
      id: 'smeta-waste-records',
      section: 'Environment — Waste',
      text: 'Which waste transfer records cover the audit period?',
      mode: 'collection',
      domain: 'WASTE_AND_WATER',
      fieldName: 'quantity',
      guidance: 'Listed individually, because an auditor samples them one by one.',
    },
    {
      id: 'smeta-production',
      section: 'Environment — Site context',
      text: 'What was the site’s output over the audit period?',
      mode: 'assemble',
      domain: 'PRODUCTION',
      fieldName: 'quantity_produced',
      unit: 'tonnes',
    },
  ],
}

const bCorp: QuestionnaireTemplate = {
  id: 'b-corp',
  name: 'B Corp Impact Assessment',
  framework: 'B Lab',
  description:
    'The Environment section figures the B Impact Assessment asks you to enter — energy, water, waste, emissions and the output they are measured against. Governance, workers and community are answered in the assessment itself.',
  status: 'available',
  questions: [
    {
      id: 'bia-energy',
      section: 'Environment — Energy',
      text: 'What was your total energy use in the last fiscal year?',
      mode: 'assemble',
      domain: 'ENERGY',
      fieldName: 'total_consumption_kwh',
      unit: 'kwh',
    },
    {
      id: 'bia-renewable',
      section: 'Environment — Energy',
      text: 'How much renewable electricity have you certificates for?',
      mode: 'assemble',
      domain: 'ENERGY',
      fieldName: 'quantity_mwh',
      unit: 'kwh',
      guidance:
        'From your stored renewable energy certificates. The assessment asks for this as a share of total use — it is shown here as the certificated amount, not as a percentage, because Arbor does not divide one figure by another.',
    },
    {
      id: 'bia-emissions',
      section: 'Environment — Emissions',
      text: 'What emissions have you measured and reported?',
      mode: 'direct',
      domain: 'EMISSIONS',
      fieldName: 'total_co2e',
      unit: 'tonnes_co2e',
    },
    {
      id: 'bia-water',
      section: 'Environment — Water',
      text: 'What was your total water use?',
      mode: 'assemble',
      domain: 'WASTE_AND_WATER',
      fieldName: 'quantity_m3',
      unit: 'm3',
    },
    {
      id: 'bia-waste',
      section: 'Environment — Waste',
      text: 'How much waste did you produce?',
      mode: 'assemble',
      domain: 'WASTE_AND_WATER',
      fieldName: 'quantity',
      unit: 'tonnes',
    },
    {
      id: 'bia-output',
      section: 'Environment — Intensity',
      text: 'What was your production output for the same year?',
      mode: 'assemble',
      domain: 'PRODUCTION',
      fieldName: 'quantity_produced',
      unit: 'tonnes',
    },
  ],
}

const genericSupplier: QuestionnaireTemplate = {
  id: 'generic-supplier',
  name: 'Generic supplier questionnaire',
  framework: 'Generic',
  description:
    'Everything Arbor holds about your operations, in one list — for a customer request that does not follow a named framework. Copy the figures you need.',
  status: 'available',
  questions: [
    {
      id: 'gen-electricity',
      section: 'Energy',
      text: 'How much energy did you use?',
      mode: 'assemble',
      domain: 'ENERGY',
      fieldName: 'total_consumption_kwh',
      unit: 'kwh',
    },
    {
      id: 'gen-energy-records',
      section: 'Energy',
      text: 'Which bills is that made up of?',
      mode: 'collection',
      domain: 'ENERGY',
      fieldName: 'total_consumption_kwh',
    },
    {
      id: 'gen-production',
      section: 'Production',
      text: 'How much did you produce?',
      mode: 'assemble',
      domain: 'PRODUCTION',
      fieldName: 'quantity_produced',
      unit: 'tonnes',
    },
    {
      id: 'gen-materials',
      section: 'Materials',
      text: 'How much material did you take in?',
      mode: 'assemble',
      domain: 'MATERIALS',
      fieldName: 'quantity',
      unit: 'tonnes',
    },
    {
      id: 'gen-logistics',
      section: 'Logistics',
      text: 'What weight of goods did you ship?',
      mode: 'assemble',
      domain: 'LOGISTICS',
      fieldName: 'shipment_weight',
      unit: 'tonnes',
    },
    {
      id: 'gen-water',
      section: 'Water and waste',
      text: 'How much water did you use?',
      mode: 'assemble',
      domain: 'WASTE_AND_WATER',
      fieldName: 'quantity_m3',
      unit: 'm3',
    },
    {
      id: 'gen-waste',
      section: 'Water and waste',
      text: 'How much waste did you handle?',
      mode: 'assemble',
      domain: 'WASTE_AND_WATER',
      fieldName: 'quantity',
      unit: 'tonnes',
    },
    {
      id: 'gen-emissions',
      section: 'Emissions',
      text: 'What emissions have you had reported or certified?',
      mode: 'direct',
      domain: 'EMISSIONS',
      fieldName: 'total_co2e',
      unit: 'tonnes_co2e',
      guidance:
        'Only figures from a document you have submitted. Arbor does not calculate emissions from your energy use — your customer’s tool does that.',
    },
  ],
}

export const QUESTIONNAIRE_TEMPLATES: QuestionnaireTemplate[] = [
  cdpClimate,
  ecovadis,
  sedexSmeta,
  bCorp,
  genericSupplier,
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
