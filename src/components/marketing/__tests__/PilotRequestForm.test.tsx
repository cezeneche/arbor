/** @jest-environment jsdom */
import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'
import { PilotRequestForm } from '../PilotRequestForm'

test('preserves audience and plan, keeps entries after failure, and confirms a retry', async () => {
  const user = userEvent.setup()
  const fetchMock = jest.fn()
    .mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Please try again.' }) })
    .mockResolvedValueOnce({ ok: true })
  global.fetch = fetchMock

  render(<PilotRequestForm initialAudience="buyer" initialPlan="Business" />)
  expect(screen.getByLabelText(/what best describes you/i)).toHaveValue('buyer')
  expect(screen.getByLabelText(/plan of interest/i)).toHaveValue('Business')
  await user.type(screen.getByLabelText(/organisation/i), 'Example Buyer Ltd')
  await user.type(screen.getByLabelText(/your name/i), 'Alex Morgan')
  await user.type(screen.getByLabelText(/work email/i), 'alex@example.com')
  await user.click(screen.getByRole('button', { name: 'Send request' }))

  expect(await screen.findByRole('alert')).toHaveTextContent('Please try again.')
  expect(screen.getByLabelText(/organisation/i)).toHaveValue('Example Buyer Ltd')
  const firstPayload = JSON.parse(fetchMock.mock.calls[0][1].body)
  expect(firstPayload).toMatchObject({ audience: 'buyer', plan: 'Business', orgName: 'Example Buyer Ltd' })

  await user.click(screen.getByRole('button', { name: 'Send request' }))
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Request saved'))
  expect(fetchMock).toHaveBeenCalledTimes(2)
  expect(JSON.parse(fetchMock.mock.calls[1][1].body).requestId).toBe(firstPayload.requestId)
})

test('changing audience clears an incompatible plan', async () => {
  const user = userEvent.setup()
  render(<PilotRequestForm initialAudience="supplier" initialPlan="Growth" />)
  expect(screen.getByLabelText(/plan of interest/i)).toHaveValue('Growth')
  await user.selectOptions(screen.getByLabelText(/what best describes you/i), 'buyer')
  expect(screen.getByLabelText(/plan of interest/i)).toHaveValue('')
})

test('uses a new request ID when details change after an uncertain response', async () => {
  const user = userEvent.setup()
  const fetchMock = jest.fn()
    .mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Please try again.' }) })
    .mockResolvedValueOnce({ ok: true })
  global.fetch = fetchMock

  render(<PilotRequestForm initialAudience="general" initialPlan="" />)
  await user.type(screen.getByLabelText(/organisation/i), 'Example Ltd')
  await user.type(screen.getByLabelText(/your name/i), 'Alex Morgan')
  await user.type(screen.getByLabelText(/work email/i), 'alex@example.com')
  await user.click(screen.getByRole('button', { name: 'Send request' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Please try again.')

  const firstPayload = JSON.parse(fetchMock.mock.calls[0][1].body)
  await user.type(screen.getByLabelText(/organisation/i), ' Updated')
  await user.click(screen.getByRole('button', { name: 'Send request' }))
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  const secondPayload = JSON.parse(fetchMock.mock.calls[1][1].body)
  expect(secondPayload.orgName).toBe('Example Ltd Updated')
  expect(secondPayload.requestId).not.toBe(firstPayload.requestId)
})

// Importers arrive from the CBAM page. They have no planned plan to choose,
// and the request has to say it is about CBAM so the right person picks it up.
test('an importer request says it is about CBAM', async () => {
  const user = userEvent.setup()
  const fetchMock = jest.fn().mockResolvedValue({ ok: true })
  global.fetch = fetchMock

  render(<PilotRequestForm initialAudience="importer" initialPlan="" />)
  expect(screen.getByLabelText(/what best describes you/i)).toHaveValue('importer')
  expect(screen.getByRole('option', { name: 'Importer with CBAM obligations' })).toBeInTheDocument()
  expect(screen.queryByLabelText(/plan of interest/i)).not.toBeInTheDocument()

  await user.type(screen.getByLabelText(/organisation/i), 'Example Imports Ltd')
  await user.type(screen.getByLabelText(/your name/i), 'Sam Lee')
  await user.type(screen.getByLabelText(/work email/i), 'sam@example.com')
  await user.click(screen.getByRole('button', { name: 'Send request' }))

  await waitFor(() => expect(fetchMock).toHaveBeenCalled())
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ audience: 'importer' })
})
