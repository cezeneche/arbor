import { PendingProofSystem, PENDING_ENGINE } from '../proof'

// until a real engine is wired, the placeholder must report
// unavailability and never emit a proof.

describe('PendingProofSystem', () => {
  const engine = new PendingProofSystem()

  it('reports itself unavailable', () => {
    expect(engine.available).toBe(false)
    expect(engine.name).toBe(PENDING_ENGINE)
  })

  it('refuses to prove rather than faking one', async () => {
    await expect(engine.prove()).rejects.toThrow(/not yet available/i)
  })

  it('refuses to verify', async () => {
    await expect(engine.verify()).rejects.toThrow(/not yet available/i)
  })
})
