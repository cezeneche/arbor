import { calculateEmbeddedEmissions } from '../embedded-emissions'
import { computeRecordHash, verifyChain } from '../audit-chain'
import { applyEmissionFactor } from '../emission-factors'
import type { AuditPayload } from '../audit-chain'

// Set the required env var for audit chain tests
beforeAll(() => {
  process.env.AUDIT_CHAIN_SECRET = 'test-secret-do-not-use-in-production'
})

describe('calculateEmbeddedEmissions — @regulatory', () => {
  it('[EU 2023/1773 Art. 4(1)] total embedded = direct + indirect', () => {
    const result = calculateEmbeddedEmissions({
      directEmissionsKgCo2e: 800,
      indirectEmissionsKgCo2e: 200,
      productMassKg: 1000,
      tier: 3,
    })
    expect(result.totalEmbeddedEmissionsKgCo2e).toBe(1000)
  })

  it('[EU 2023/1773 Art. 4(2)] specific embedded = total / mass × 1000 (per tonne)', () => {
    const result = calculateEmbeddedEmissions({
      directEmissionsKgCo2e: 1000,
      indirectEmissionsKgCo2e: 0,
      productMassKg: 500,
      tier: 3,
    })
    // 1000 kg / 500 kg * 1000 = 2000 kg CO2e per tonne
    expect(result.embeddedEmissionsPerTonneKgCo2e).toBe(2000)
  })

  it('citation references EU 2023/1773 Art. 4', () => {
    const result = calculateEmbeddedEmissions({
      directEmissionsKgCo2e: 100,
      indirectEmissionsKgCo2e: 50,
      productMassKg: 100,
      tier: 2,
    })
    expect(result.citation).toContain('2023/1773')
    expect(result.citation).toContain('Art. 4')
  })

  it('throws when product mass is zero', () => {
    expect(() =>
      calculateEmbeddedEmissions({
        directEmissionsKgCo2e: 100,
        indirectEmissionsKgCo2e: 0,
        productMassKg: 0,
        tier: 3,
      }),
    ).toThrow('Product mass must be greater than zero')
  })

  it('throws when direct emissions are negative', () => {
    expect(() =>
      calculateEmbeddedEmissions({
        directEmissionsKgCo2e: -1,
        indirectEmissionsKgCo2e: 0,
        productMassKg: 100,
        tier: 3,
      }),
    ).toThrow('Direct emissions cannot be negative')
  })
})

describe('applyEmissionFactor — @regulatory', () => {
  it('[GHG Protocol Corporate Standard Ch.4] co2eKg = activityValue × factor', () => {
    const result = applyEmissionFactor({
      activityValue: 1000,
      activityUnit: 'kWh',
      factor: 0.233,
      factorUnit: 'kg CO2e/kWh',
      factorSource: 'DEFRA',
      factorVersion: '2024',
      citation: 'DEFRA Conversion Factors 2024 — UK Grid Electricity',
    })
    expect(result.co2eKg).toBeCloseTo(233, 5)
    expect(result.calculationExpression).toContain('1000 kWh')
    expect(result.calculationExpression).toContain('0.233 kg CO2e/kWh')
  })

  it('calculationExpression is a complete, human-readable string', () => {
    const result = applyEmissionFactor({
      activityValue: 500,
      activityUnit: 'kg',
      factor: 2.5,
      factorUnit: 'kg CO2e/kg',
      factorSource: 'IPCC AR6',
      factorVersion: '2021',
      citation: 'IPCC AR6 WG1 — GWP100',
    })
    expect(result.calculationExpression).toMatch(/500 kg × 2\.5 kg CO2e\/kg = 1250\.0000 kg CO2e/)
  })
})

describe('audit chain', () => {
  const basePayload: AuditPayload = {
    recordId: 'rec_001',
    entityId: 'ent_001',
    domain: 'ENERGY',
    fieldName: 'total_consumption_kwh',
    value: 150000,
    unit: 'kwh',
    trustTier: 'A',
    submittedAt: '2024-04-01T00:00:00.000Z',
    submittedById: 'user_001',
  }

  it('computeRecordHash is deterministic for identical inputs', () => {
    const h1 = computeRecordHash(basePayload, null)
    const h2 = computeRecordHash(basePayload, null)
    expect(h1).toBe(h2)
  })

  it('computeRecordHash changes when previousHash changes', () => {
    const h1 = computeRecordHash(basePayload, null)
    const h2 = computeRecordHash(basePayload, 'abc123')
    expect(h1).not.toBe(h2)
  })

  it('verifyChain passes a valid two-entry chain', () => {
    const hash0 = computeRecordHash(basePayload, null)
    const payload1 = { ...basePayload, recordId: 'rec_002', value: 200000 }
    const hash1 = computeRecordHash(payload1, hash0)

    const chain = [
      { hash: hash0, previousHash: null, payload: basePayload },
      { hash: hash1, previousHash: hash0, payload: payload1 },
    ]
    expect(verifyChain(chain)).toBe(true)
  })

  it('verifyChain returns false when a payload is tampered', () => {
    const hash0 = computeRecordHash(basePayload, null)
    const payload1 = { ...basePayload, recordId: 'rec_002', value: 200000 }
    const hash1 = computeRecordHash(payload1, hash0)

    const tamperedPayload = { ...payload1, value: 999999 }

    const chain = [
      { hash: hash0, previousHash: null, payload: basePayload },
      { hash: hash1, previousHash: hash0, payload: tamperedPayload },
    ]
    expect(verifyChain(chain)).toBe(false)
  })

  it('verifyChain returns false when previousHash link is broken', () => {
    const hash0 = computeRecordHash(basePayload, null)
    const payload1 = { ...basePayload, recordId: 'rec_002', value: 200000 }
    const hash1 = computeRecordHash(payload1, hash0)

    const chain = [
      { hash: hash0, previousHash: null, payload: basePayload },
      { hash: hash1, previousHash: 'wrong-previous-hash', payload: payload1 },
    ]
    expect(verifyChain(chain)).toBe(false)
  })
})
