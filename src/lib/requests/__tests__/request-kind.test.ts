import { REQUEST_KINDS, resolveRequestKind } from '../request-kind'
import { REQUEST_VIEWS, resolveRequestView } from '../request-views'

// The two request kinds are not variants of one flow. Asking the user which they
// mean, rather than inferring it, is the point: the wrong guess sends a supplier
// a form they cannot answer, and the request just goes unanswered.

describe('request kinds', () => {
  it('offers exactly the two that exist', () => {
    expect(REQUEST_KINDS.map(k => k.id)).toEqual(['records', 'cbam'])
  })

  it('each says what is asked for and where the answer lands', () => {
    // A user choosing between them needs both halves: what the supplier is asked,
    // and what it produces. Either alone leaves the choice a guess.
    for (const kind of REQUEST_KINDS) {
      expect(kind.asks.length).toBeGreaterThan(0)
      expect(kind.produces.length).toBeGreaterThan(0)
      expect(kind.href.length).toBeGreaterThan(0)
    }
  })

  it('routes records requests to the supply-chain flow', () => {
    const records = REQUEST_KINDS.find(k => k.id === 'records')!
    expect(records.href).toContain('/supply-chain/request')
  })

  it('routes CBAM requests into the CBAM section, not DataRequest', () => {
    // Nucleos's three-field contract is not Arbor's DataRequest shape, and
    // reusing the answer assembly would break when the intensity needs
    // multiplying by mass.
    const cbam = REQUEST_KINDS.find(k => k.id === 'cbam')!
    expect(cbam.href).toContain('/cbam')
  })

  it('names the unit on the CBAM ask, because the unit is the trap', () => {
    // A supplier sending a total rather than an intensity overstates the line by
    // its mass in tonnes.
    const cbam = REQUEST_KINDS.find(k => k.id === 'cbam')!
    expect(cbam.asks).toMatch(/per tonne/i)
  })

  it('does not resolve an unknown kind — the user must choose', () => {
    expect(resolveRequestKind('nonsense')).toBeNull()
    expect(resolveRequestKind(undefined)).toBeNull()
    expect(resolveRequestKind('')).toBeNull()
  })

  it('resolves each known kind', () => {
    expect(resolveRequestKind('records')).toBe('records')
    expect(resolveRequestKind('cbam')).toBe('cbam')
  })
})

describe('request views', () => {
  it('opens on what is waiting', () => {
    // The only view with a deadline attached.
    expect(resolveRequestView(undefined)).toBe('waiting')
  })

  it('falls back rather than erroring', () => {
    expect(resolveRequestView('nonsense')).toBe('waiting')
    expect(resolveRequestView(null)).toBe('waiting')
  })

  it('resolves each known view', () => {
    for (const view of REQUEST_VIEWS) {
      expect(resolveRequestView(view.id)).toBe(view.id)
    }
  })

  it('view ids are unique', () => {
    const ids = REQUEST_VIEWS.map(v => v.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
