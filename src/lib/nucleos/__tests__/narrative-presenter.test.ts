import { presentNarrative } from '../narrative-presenter'

// A kept audit narrative, as the case page shows it: what it says, whether a
// person must review it and why, and who wrote it when.

const row = {
  generatedAt: new Date('2027-05-01T09:05:00Z'),
  reviewRequired: true,
  reviewReasons: ['Direct emissions in the narrative do not match the package.'],
  narrative: {
    executive_summary: 'Summary.',
    methodology: 'Method.',
    limitations: 'One limitation.',
    open_gaps: [{ field: 'installation_id', issue: 'Ask the supplier for the installation.', current_confidence: 0 }],
    results: {},
  },
  emailedAt: new Date('2027-05-01T09:06:00Z'),
  packHash: 'a'.repeat(64),
}

describe('presentNarrative', () => {
  it('shows the narrative, the review verdict and its reasons', () => {
    expect(presentNarrative(row, 'Ada Lovelace')).toEqual({
      byline: 'Written 1 May 2027, 10:05 at the request of Ada Lovelace',
      reviewRequired: true,
      reasons: ['Direct emissions in the narrative do not match the package.'],
      emailed: 'The organisation was emailed about the review.',
      summary: 'Summary.',
      methodology: 'Method.',
      limitations: ['One limitation.'],
      openGaps: [{ field: 'installation_id', issue: 'Ask the supplier for the installation.' }],
      packHash: 'a'.repeat(64),
    })
  })

  it('accepts limitations written as a list, and drops empty ones', () => {
    const out = presentNarrative({ ...row, narrative: { ...row.narrative, limitations: ['A.', '', 'B.'] } }, null)
    expect(out.limitations).toEqual(['A.', 'B.'])
    expect(out.byline).toBe('Written 1 May 2027, 10:05')
  })

  it('says when the review could not be emailed', () => {
    expect(presentNarrative({ ...row, emailedAt: null }, null).emailed).toBe(
      'No one in the organisation was emailed about the review.',
    )
  })

  it('says nothing about email for a narrative that needs no review', () => {
    expect(presentNarrative({ ...row, reviewRequired: false, reviewReasons: [] }, null).emailed).toBeNull()
  })

  it('copes with a narrative missing its sections', () => {
    const out = presentNarrative({ ...row, narrative: {} }, null)
    expect(out).toMatchObject({ summary: null, methodology: null, limitations: [], openGaps: [] })
  })
})
