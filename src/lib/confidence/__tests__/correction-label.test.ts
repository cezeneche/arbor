import { captureCorrectionLabel, type CorrectionLabelStore } from '../correction-label'

// A supplier correcting a machine-read value from Review is the same signal as
// a reviewer correcting it before it was saved: the model read it wrong. The
// label is built from what the model actually extracted and how sure it was,
// not from the stored record — a reviewed record carries confidence 1.0, which
// would teach calibration nothing.

function store(job: unknown) {
  const created: Record<string, unknown>[] = []
  const db: CorrectionLabelStore = {
    document: { findUnique: jest.fn(async () => job) as never },
    groundTruthLabel: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data)
        return { id: 'label-1' }
      }) as never,
    },
  }
  return { db, created }
}

const input = {
  entityId: 'org',
  documentId: 'doc-1',
  fieldName: 'electricity_kwh',
  domain: 'ENERGY',
  newRecordId: 'rec-new',
  correctedValue: 44900,
}

const withExtraction = {
  documentType: 'ELECTRICITY_BILL',
  extractionJobs: [
    {
      documentClass: null,
      extractorVersion: 'claude-sonnet-4-6+v1',
      extractedFields: [{ rawValue: '41,200', confidenceScore: 0.91 }],
    },
  ],
}

it('records the correction against what the model read', async () => {
  const { db, created } = store(withExtraction)
  expect(await captureCorrectionLabel(db, input)).toBe(true)
  expect(created).toEqual([
    {
      entityId: 'org',
      documentId: 'doc-1',
      recordId: 'rec-new',
      fieldName: 'electricity_kwh',
      documentClass: 'ELECTRICITY_BILL',
      domain: 'ENERGY',
      extractedValue: '41,200',
      confirmedValue: '44900',
      wasCorrect: false,
      confidenceAtExtraction: 0.91,
      source: 'REVIEW_CORRECTED',
      expectedInformationGain: null,
      lowInformation: null,
      extractorVersion: 'claude-sonnet-4-6+v1',
    },
  ])
})

it('records the model as right when the correction undoes a person’s earlier mistake', async () => {
  const { db, created } = store(withExtraction)
  await captureCorrectionLabel(db, { ...input, correctedValue: 41200 })
  expect(created[0]).toMatchObject({ wasCorrect: true, source: 'REVIEW_CONFIRMED' })
})

it('writes nothing when the model never read this field', async () => {
  const { db, created } = store({
    ...withExtraction,
    extractionJobs: [{ ...withExtraction.extractionJobs[0], extractedFields: [] }],
  })
  expect(await captureCorrectionLabel(db, input)).toBe(false)
  expect(created).toEqual([])
})

it('writes nothing when the document is gone', async () => {
  const { db, created } = store(null)
  expect(await captureCorrectionLabel(db, input)).toBe(false)
  expect(created).toEqual([])
})
