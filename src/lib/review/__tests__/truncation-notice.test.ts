import { truncationNotice } from '../truncation-notice'

// Silent data loss is worse than failed extraction, because failure is visible.
// A reviewer confirming fields off a partially-read document has no way to know
// the rest of it existed, so the notice has to name what was cut and why.

describe('truncationNotice', () => {
  it('shows nothing when the whole document was read', () => {
    expect(truncationNotice({ truncated: false, truncationReason: null })).toBeNull()
  })

  it('shows nothing when there is no job yet', () => {
    expect(truncationNotice(null)).toBeNull()
  })

  it('warns when the source was truncated', () => {
    const notice = truncationNotice({
      truncated: true,
      truncationReason: 'Only the first 3 pages were read',
    })
    expect(notice).not.toBeNull()
    expect(notice!.reason).toBe('Only the first 3 pages were read')
  })

  it('names what is missing rather than only that something is', () => {
    const notice = truncationNotice({
      truncated: true,
      truncationReason: 'Only the first 3 pages were read',
    })
    expect(notice!.message).toContain('not been read')
    expect(notice!.message).toContain('Only the first 3 pages were read')
  })

  it('still warns when the reason was not recorded', () => {
    const notice = truncationNotice({ truncated: true, truncationReason: null })
    expect(notice).not.toBeNull()
    expect(notice!.reason).toBe('The reason was not recorded.')
  })

  it('warns on the flag alone, never inferring from the reason text', () => {
    // A reason without the flag is metadata, not a truncation.
    expect(
      truncationNotice({ truncated: false, truncationReason: 'Only the first 3 pages were read' }),
    ).toBeNull()
  })

  it('tells the reviewer confirmation covers only what was read', () => {
    const notice = truncationNotice({ truncated: true, truncationReason: 'page cap' })
    expect(notice!.message.toLowerCase()).toContain('confirm')
  })
})
