/**
 * @jest-environment jsdom
 */

// The reminder to confirm an email address. It used to say "we sent a link"
// to everyone. Accounts created before confirmation existed (19 September
// 2026) were never sent one, so the banner told them to look for an email that
// did not exist. It now says a link was sent only when one was.

import React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'

import { VerifyEmailReminder } from '../VerifyEmailReminder'

const fetchMock = jest.fn()
beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockResolvedValue({ ok: true })
  global.fetch = fetchMock as unknown as typeof fetch
})

describe('VerifyEmailReminder', () => {
  it('does not claim a link was sent when none ever was', () => {
    render(<VerifyEmailReminder email="ada@example.com" linkSent={false} />)
    expect(screen.queryByText(/we sent a link/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send me a confirmation link' })).toBeInTheDocument()
    expect(screen.getByText(/ada@example.com/)).toBeInTheDocument()
  })

  it('says a link was sent, and offers another, when one was', () => {
    render(<VerifyEmailReminder email="ada@example.com" linkSent />)
    expect(screen.getByText(/we sent a link to ada@example.com/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send it again' })).toBeInTheDocument()
  })

  it('confirms the send after the first link is asked for', async () => {
    render(<VerifyEmailReminder email="ada@example.com" linkSent={false} />)
    await userEvent.click(screen.getByRole('button', { name: 'Send me a confirmation link' }))
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/verify-email/resend', { method: 'POST' })
    expect(await screen.findByText(/A link is on its way to ada@example.com/)).toBeInTheDocument()
  })

  it('offers to try again when the send fails', async () => {
    fetchMock.mockResolvedValue({ ok: false })
    render(<VerifyEmailReminder email="ada@example.com" linkSent={false} />)
    await userEvent.click(screen.getByRole('button', { name: 'Send me a confirmation link' }))
    expect(await screen.findByRole('button', { name: 'Try sending it again' })).toBeInTheDocument()
  })
})
