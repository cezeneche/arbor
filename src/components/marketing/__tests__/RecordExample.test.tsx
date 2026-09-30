/** @jest-environment jsdom */
import React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'
import { RecordExample } from '../RecordExample'

test('explains the illustrative source and Declared status on request', async () => {
  const user = userEvent.setup()
  render(<RecordExample />)
  expect(screen.getByText('Illustrative example')).toBeInTheDocument()
  const toggle = screen.getByRole('button', { name: 'View source' })
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  expect(screen.getByText(/A source document alone does not prove/)).not.toBeVisible()
  await user.click(toggle)
  expect(screen.getByText(/A source document alone does not prove/)).toBeVisible()
  expect(screen.getByRole('button', { name: 'Hide source' })).toHaveAttribute('aria-expanded', 'true')
})
