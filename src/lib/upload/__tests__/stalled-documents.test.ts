import { classifyStalledDocument, STALLED_AFTER_MINUTES } from '../stalled-documents'

describe('classifyStalledDocument', () => {
  // The defect: upload could succeed with the enqueue failing, leaving a document
  // PENDING for ever with nothing scheduled to read it.
  it('re-queues a document whose extraction never started', () => {
    expect(classifyStalledDocument({ status: 'PENDING', hasExtractionJob: false })).toBe('REQUEUE')
  })

  // A run that began and died may have written part of its work; asking for it
  // again could duplicate that, so a person decides.
  it('hands an abandoned mid-run document to the user rather than re-running it', () => {
    expect(classifyStalledDocument({ status: 'EXTRACTING', hasExtractionJob: true })).toBe(
      'MARK_FOR_REVIEW',
    )
    expect(classifyStalledDocument({ status: 'PENDING', hasExtractionJob: true })).toBe(
      'MARK_FOR_REVIEW',
    )
  })

  it('leaves a generous window so a slow live run is never disturbed', () => {
    expect(STALLED_AFTER_MINUTES).toBeGreaterThanOrEqual(15)
  })
})
