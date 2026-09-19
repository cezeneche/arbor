import { escapeHtml, getResend } from '../client'

describe('escapeHtml', () => {
  it('escapes the five characters that change meaning in HTML', () => {
    expect(escapeHtml(`<a href="x" onclick='y'>&</a>`)).toBe(
      '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;',
    )
  })

  it('renders null and undefined as empty', () => {
    expect(escapeHtml(null)).toBe('')
    expect(escapeHtml(undefined)).toBe('')
  })
})

describe('getResend', () => {
  it('is null without an API key, so email stays best-effort', () => {
    const saved = process.env.RESEND_API_KEY
    delete process.env.RESEND_API_KEY
    expect(getResend()).toBeNull()
    if (saved !== undefined) process.env.RESEND_API_KEY = saved
  })
})
