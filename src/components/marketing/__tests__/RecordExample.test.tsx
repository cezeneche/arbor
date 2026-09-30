/** @jest-environment jsdom */
import React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'
import { RecordExample } from '../RecordExample'

// The example leads with the product at its best — a figure read from its
// source and confirmed on review is Verified — and says on request exactly
// what that label means, so it never reads as more than it is.
test('shows a Verified record and explains the label on request', async () => {
  const user = userEvent.setup()
  render(<RecordExample />)
  expect(screen.getByText('Illustrative example')).toBeInTheDocument()
  expect(screen.getByText('Verified')).toBeInTheDocument()
  const toggle = screen.getByRole('button', { name: 'View source' })
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  expect(screen.getByText(/confirmed on review/)).not.toBeVisible()
  await user.click(toggle)
  expect(screen.getByText(/confirmed on review/)).toBeVisible()
  expect(screen.getByText(/not an audit of the site’s electricity use/)).toBeVisible()
  expect(screen.getByRole('button', { name: 'Hide source' })).toHaveAttribute('aria-expanded', 'true')
})
