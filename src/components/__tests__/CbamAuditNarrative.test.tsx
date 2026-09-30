/**
 * @jest-environment jsdom
 */

// The audit narrative on a case: what it says, whether it needs review and
// why, and the one action — write it, or write it again.

import React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'

const refresh = jest.fn()
jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

import { CbamAuditNarrative } from '../CbamAuditNarrative'
import type { PresentedNarrative } from '@/lib/nucleos/narrative-presenter'

const fetchMock = jest.fn()
beforeEach(() => {
  fetchMock.mockReset()
  refresh.mockReset()
  global.fetch = fetchMock as unknown as typeof fetch
})
function answer(body: unknown, status = 200) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body })
}

const kept: PresentedNarrative = {
  byline: 'Written 1 May 2027, 10:05 at the request of Ada Lovelace',
  reviewRequired: true,
  reasons: ['Direct emissions in the narrative do not match the package.'],
  emailed: 'The organisation was emailed about the review.',
  summary: 'The case declares 850 tCO₂e.',
  methodology: 'Default values under EU 2023/1773 Art. 4.',
  limitations: ['The installation could not be read.'],
  openGaps: [{ field: 'installation_id', issue: 'Ask the supplier for the installation.' }],
  packHash: 'a'.repeat(64),
}

describe('CbamAuditNarrative', () => {
  it('offers to write the narrative when there is none', async () => {
    fetchMock.mockReturnValue(answer({ ok: true, narrativeId: 'nar-1', reviewRequired: false, emailed: 0, emailProblem: null }, 201))
    render(<CbamAuditNarrative caseId="case-1" narrative={null} />)

    await userEvent.click(screen.getByRole('button', { name: 'Write the audit narrative' }))
    expect(fetchMock).toHaveBeenCalledWith('/api/cbam/cases/case-1/narrative', { method: 'POST' })
    expect(refresh).toHaveBeenCalled()
  })

  it('shows a narrative that needs review, and why, before its text', () => {
    render(<CbamAuditNarrative caseId="case-1" narrative={kept} />)
    expect(screen.getByText('Needs review before it is relied on')).toBeInTheDocument()
    expect(screen.getByText('Direct emissions in the narrative do not match the package.')).toBeInTheDocument()
    expect(screen.getByText('The organisation was emailed about the review.')).toBeInTheDocument()
    expect(screen.getByText('The case declares 850 tCO₂e.')).toBeInTheDocument()
    expect(screen.getByText(/Ask the supplier for the installation/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Write it again' })).toBeInTheDocument()
  })

  it('says why a narrative could not be written', async () => {
    fetchMock.mockReturnValue(answer({ error: 'The case has gaps that stop a narrative being written.', code: 'BLOCKED' }, 422))
    render(<CbamAuditNarrative caseId="case-1" narrative={null} />)
    await userEvent.click(screen.getByRole('button', { name: 'Write the audit narrative' }))
    expect(await screen.findByText('The case has gaps that stop a narrative being written.')).toBeInTheDocument()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('passes on an email that could not be sent', async () => {
    fetchMock.mockReturnValue(
      answer({ ok: true, narrativeId: 'nar-2', reviewRequired: true, emailed: 0, emailProblem: 'The review notice could not be emailed: RESEND_API_KEY is not set' }, 201),
    )
    render(<CbamAuditNarrative caseId="case-1" narrative={kept} />)
    await userEvent.click(screen.getByRole('button', { name: 'Write it again' }))
    expect(await screen.findByText(/could not be emailed/)).toBeInTheDocument()
  })
})
