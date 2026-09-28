import { NarrativeBlockedError, NarrativeNotAllowedError, runCompliancePack } from '../narrative-client'
import { NucleosUnavailableError } from '../extraction-client'

// Asking Nucleos to write a case's audit narrative. What comes back is the
// narrative, whether a person must review it and why, and the pack's hash.

const ORIGINAL = { ...process.env }
beforeEach(() => {
  process.env.NUCLEOS_URL = 'https://nucleos.test'
  process.env.NUCLEOS_INTERNAL_TOKEN = 'token'
})
afterEach(() => {
  process.env = { ...ORIGINAL }
})

function fake(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = []
  const impl = jest.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return new Response(JSON.stringify(body), { status })
  })
  return { impl: impl as unknown as typeof fetch, calls }
}

const narrative = { executive_summary: 's', methodology: 'm', limitations: 'l', open_gaps: [], results: {} }

describe('runCompliancePack', () => {
  it('returns the narrative, the review verdict and the pack hash', async () => {
    const { impl, calls } = fake(200, {
      type: 'cbam_compliance_pack_v1',
      narrative,
      review: { required: true, reasons: ['A figure does not match.'] },
      audit: { payload_hash: 'f'.repeat(64) },
      report_package: { big: 'not needed' },
    })
    await expect(runCompliancePack('case-1', impl)).resolves.toEqual({
      narrative,
      review: { required: true, reasons: ['A figure does not match.'] },
      packHash: 'f'.repeat(64),
    })
    expect(calls[0].url).toBe('https://nucleos.test/api/cbam/cases/case-1/compliance-pack')
    expect(calls[0].init.method).toBe('POST')
  })

  it('treats a pack with no verdict as needing review', async () => {
    const { impl } = fake(200, { narrative, audit: {} })
    await expect(runCompliancePack('case-1', impl)).resolves.toMatchObject({
      review: { required: true, reasons: ['Nucleos did not say whether this narrative needs review.'] },
    })
  })

  it('says the service token lacks the narrative scope, rather than that Nucleos is down', async () => {
    await expect(runCompliancePack('case-1', fake(403, { detail: 'Missing scope' }).impl)).rejects.toBeInstanceOf(
      NarrativeNotAllowedError,
    )
  })

  it('names the gaps that stop a narrative being written', async () => {
    const err = await runCompliancePack(
      'case-1',
      fake(422, { message: 'Data quality blocking issues', data_quality: { blocking: true, missing: ['direct_embedded_kgco2e'] } }).impl,
    ).catch(e => e)
    expect(err).toBeInstanceOf(NarrativeBlockedError)
    expect((err as NarrativeBlockedError).missing).toEqual(['direct_embedded_kgco2e'])
  })

  it('fails closed otherwise', async () => {
    await expect(runCompliancePack('case-1', fake(502, {}).impl)).rejects.toBeInstanceOf(NucleosUnavailableError)
  })
})
