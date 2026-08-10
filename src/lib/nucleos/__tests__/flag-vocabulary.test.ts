import { explainFlag, explainFlagReason } from '../flag-vocabulary'

// The flags are the anti-hallucination signal a reviewer acts on. The contract
// carries them verbatim; this adds plain English in front without replacing them.
// Summarising would leave "there was an issue"; showing only the token would
// leave the reviewer decoding repair_failed:incoterm.

describe('explainFlag', () => {
  it('always preserves the raw string', () => {
    for (const raw of ['arbiter_conflict:cn_code', 'repair_failed:incoterm', 'something_new:x']) {
      expect(explainFlag(raw).raw).toBe(raw)
    }
  })

  it('explains an arbiter conflict and names the field', () => {
    const flag = explainFlag('arbiter_conflict:cn_code')
    expect(flag.explanation).toContain('cn_code')
    expect(flag.explanation).toMatch(/disagreed/i)
    expect(flag.serious).toBe(true)
  })

  it('explains a repair failure', () => {
    expect(explainFlag('repair_failed:incoterm').explanation).toContain('incoterm')
  })

  it('explains an unevidenced model value as rejected', () => {
    // The reviewer needs to know the value did not come from the document.
    const flag = explainFlag('claude_value_not_evidenced_in_text')
    expect(flag.explanation).toMatch(/does not appear/i)
    expect(flag.serious).toBe(true)
  })

  it('treats a dropped goods line as serious', () => {
    expect(explainFlag('line_count_disagreement').serious).toBe(true)
    expect(explainFlag('claude_line_added_beyond_deterministic').serious).toBe(true)
  })

  it('explains truncation and what confirming actually covers', () => {
    const flag = explainFlag('source_truncated:Only the first 3 pages were read')
    expect(flag.explanation).toContain('first 3 pages')
    expect(flag.explanation).toMatch(/only the part that was read/i)
    expect(flag.serious).toBe(true)
  })

  it('explains an unapplied mark-up as understating the amount', () => {
    const flag = explainFlag('cbam_selector:markup_not_applied:UK')
    expect(flag.explanation).toMatch(/understates/i)
    expect(flag.serious).toBe(true)
  })

  it('keeps an unrecognised flag visible', () => {
    // Dropping what it does not know would hide precisely the novel signal
    // worth reading.
    const flag = explainFlag('some_future_flag:detail')
    expect(flag.raw).toBe('some_future_flag:detail')
    expect(flag.explanation).toBeNull()
  })
})

describe('explainFlagReason', () => {
  it('splits a joined reason into its flags', () => {
    const flags = explainFlagReason('repair_failed:incoterm; confidence_below_threshold:0.42')
    expect(flags).toHaveLength(2)
  })

  it('puts serious flags first', () => {
    // A reviewer scanning a card stops at the first line, so the flag that
    // should stop them has to be there.
    const flags = explainFlagReason(
      'confidence_below_threshold:0.42; arbiter_conflict:cn_code',
    )
    expect(flags[0].raw).toBe('arbiter_conflict:cn_code')
  })

  it('returns nothing for an empty reason', () => {
    expect(explainFlagReason(null)).toEqual([])
    expect(explainFlagReason('   ')).toEqual([])
  })

  it('ignores empty segments from a trailing separator', () => {
    expect(explainFlagReason('repair_failed:incoterm;')).toHaveLength(1)
  })
})
