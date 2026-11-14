/**
 * @jest-environment jsdom
 */

// "Use the published default" on a goods line: nothing is recorded until the
// person confirms, inline, having been told what the default means.

import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'

const refresh = jest.fn()
jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

import { CbamApplyDefault } from '../CbamApplyDefault'

// jsdom has no Response class; the component reads only ok and json().
function reply(status: number, body: unknown) {
  return jest.fn(async () => ({
    ok: status < 300,
    status,
    json: async () => body,
  })) as unknown as typeof fetch
}

beforeEach(() => {
  refresh.mockClear()
  global.fetch = reply(200, { recorded: true })
})

it('asks before recording, and says the default is higher', () => {
  render(<CbamApplyDefault caseId="case-1" goodsLineId="gl-1" />)
  fireEvent.click(screen.getByRole('button', { name: 'Use the published default' }))
  expect(global.fetch).not.toHaveBeenCalled()
  expect(screen.getByText(/higher than a figure from the supplier/i)).toBeInTheDocument()
})

it('records the default on confirmation and refreshes the case', async () => {
  render(<CbamApplyDefault caseId="case-1" goodsLineId="gl-1" />)
  fireEvent.click(screen.getByRole('button', { name: 'Use the published default' }))
  fireEvent.click(screen.getByRole('button', { name: 'Record the default' }))
  await waitFor(() => expect(refresh).toHaveBeenCalled())
  expect(global.fetch).toHaveBeenCalledWith('/api/cbam/cases/case-1/goods-lines/gl-1/default', {
    method: 'POST',
  })
})

it('can be cancelled without recording anything', () => {
  render(<CbamApplyDefault caseId="case-1" goodsLineId="gl-1" />)
  fireEvent.click(screen.getByRole('button', { name: 'Use the published default' }))
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(global.fetch).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'Use the published default' })).toBeInTheDocument()
})

it('shows the server’s reason when it refuses', async () => {
  global.fetch = reply(422, { error: 'There is no published default for these goods.' })
  render(<CbamApplyDefault caseId="case-1" goodsLineId="gl-1" />)
  fireEvent.click(screen.getByRole('button', { name: 'Use the published default' }))
  fireEvent.click(screen.getByRole('button', { name: 'Record the default' }))
  expect(await screen.findByText('There is no published default for these goods.')).toBeInTheDocument()
  expect(refresh).not.toHaveBeenCalled()
})
