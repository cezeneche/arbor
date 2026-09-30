/** @jest-environment jsdom */
import React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'
import InstitutionalPage from '@/app/institutional/page'

jest.mock('@/app/(marketing)/marketing.css', () => ({}))

const originalFetch = global.fetch
afterEach(() => { global.fetch = originalFetch; jest.useRealTimers() })

function fillForm() {
  fireEvent.change(screen.getByLabelText('Organisation name *'), { target: { value: 'Example Research' } })
  fireEvent.change(screen.getByLabelText('Contact name *'), { target: { value: 'Alex Example' } })
  fireEvent.change(screen.getByLabelText('Work email *'), { target: { value: 'alex@example.org' } })
  fireEvent.change(screen.getByLabelText('Primary area of interest *'), { target: { value: 'BENCHMARKS' } })
}

test('preserves input after a network failure, permits retry, and announces receipt', async () => {
  const user = userEvent.setup()
  global.fetch = jest.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce({ ok: true })
  render(<InstitutionalPage />)
  fillForm()
  await user.click(screen.getByRole('button', { name: 'Send enquiry' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('could not confirm receipt')
  expect(screen.getByLabelText('Organisation name *')).toHaveValue('Example Research')
  expect(screen.getByRole('button', { name: 'Send enquiry' })).toBeEnabled()
  await user.click(screen.getByRole('button', { name: 'Send enquiry' }))
  expect(await screen.findByText('Enquiry received')).toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('Your enquiry has been saved')
  expect(global.fetch).toHaveBeenCalledTimes(2)
  expect(JSON.parse((global.fetch as jest.Mock).mock.calls[1][1].body).orgName).toBe('Example Research')
})

test('announces server errors and recovers from a non-JSON error response', async () => {
  const user = userEvent.setup()
  global.fetch = jest.fn()
    .mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Too many requests. Please try again later.' }) })
    .mockResolvedValueOnce({ ok: false, json: async () => { throw new SyntaxError('HTML response') } })
  render(<InstitutionalPage />)
  fillForm()
  await user.click(screen.getByRole('button', { name: 'Send enquiry' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Too many requests')
  await user.click(screen.getByRole('button', { name: 'Send enquiry' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('could not save your enquiry')
  expect(screen.getByRole('button', { name: 'Send enquiry' })).toBeEnabled()
})

test('times out a stalled request and re-enables submission without clearing input', async () => {
  jest.useFakeTimers()
  global.fetch = jest.fn((_input, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
  })) as typeof fetch
  render(<InstitutionalPage />)
  fillForm()
  fireEvent.click(screen.getByRole('button', { name: 'Send enquiry' }))
  expect(screen.getByRole('button', { name: 'Sending…' })).toBeDisabled()
  await act(async () => { jest.advanceTimersByTime(20_000) })
  expect(screen.getByRole('alert')).toHaveTextContent('could not confirm receipt')
  expect(screen.getByRole('button', { name: 'Send enquiry' })).toBeEnabled()
  expect(screen.getByLabelText('Work email *')).toHaveValue('alex@example.org')
})
