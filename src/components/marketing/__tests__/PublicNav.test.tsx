/** @jest-environment jsdom */
import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'
import { PublicNav } from '../PublicNav'

let pathname = '/'
jest.mock('next/navigation', () => ({ usePathname: () => pathname }))

beforeEach(() => { pathname = '/' })

test('opens by keyboard and Escape closes it and returns focus to the toggle', async () => {
  const user = userEvent.setup()
  render(<PublicNav />)
  const toggle = screen.getByRole('button', { name: 'Menu' })
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  toggle.focus()
  await user.keyboard('{Enter}')
  expect(toggle).toHaveAttribute('aria-expanded', 'true')
  expect(document.getElementById(toggle.getAttribute('aria-controls')!)).toBeInTheDocument()
  screen.getByRole('link', { name: 'Pricing' }).focus()
  await user.keyboard('{Escape}')
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  expect(toggle).toHaveFocus()
})

test('closes after navigation and marks the current page', async () => {
  const user = userEvent.setup()
  pathname = '/pricing'
  render(<PublicNav />)
  await user.click(screen.getByRole('button', { name: 'Menu' }))
  const pricing = screen.getByRole('link', { name: 'Pricing' })
  expect(pricing).toHaveAttribute('aria-current', 'page')
  // Prevent jsdom navigation while allowing the component click handler.
  pricing.addEventListener('click', event => event.preventDefault())
  await user.click(pricing)
  expect(screen.getByRole('button', { name: 'Menu' })).toHaveAttribute('aria-expanded', 'false')
})

test('closes on outside interaction and when keyboard focus leaves navigation', async () => {
  const user = userEvent.setup()
  render(<><PublicNav /><button>Outside</button></>)
  await user.click(screen.getByRole('button', { name: 'Menu' }))
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside' }))
  expect(screen.getByRole('button', { name: 'Menu' })).toHaveAttribute('aria-expanded', 'false')
  await user.click(screen.getByRole('button', { name: 'Menu' }))
  screen.getByRole('link', { name: 'Request pilot access' }).focus()
  await user.tab()
  expect(screen.getByRole('button', { name: 'Outside' })).toHaveFocus()
  expect(screen.getByRole('button', { name: 'Menu' })).toHaveAttribute('aria-expanded', 'false')
})

test('route changes reset the disclosure, including when returning to an earlier page', async () => {
  const user = userEvent.setup()
  const { rerender } = render(<PublicNav />)
  await user.click(screen.getByRole('button', { name: 'Menu' }))
  pathname = '/about'
  rerender(<PublicNav />)
  pathname = '/'
  rerender(<PublicNav />)
  expect(screen.getByRole('button', { name: 'Menu' })).toHaveAttribute('aria-expanded', 'false')
})

// Importers are the site's second audience; their page is one click from anywhere.
test('offers the CBAM page for importers', () => {
  pathname = '/cbam-compliance'
  render(<PublicNav />)
  const cbam = screen.getByRole('link', { name: 'CBAM' })
  expect(cbam).toHaveAttribute('href', '/cbam-compliance')
  expect(cbam).toHaveAttribute('aria-current', 'page')
})
