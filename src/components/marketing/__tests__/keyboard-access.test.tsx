/**
 * @jest-environment jsdom
 */

// Keyboard access on the public site (engineering to-do B5). A keyboard user
// must be able to skip the navigation, and must be able to scroll a code
// example that is wider than a phone screen, which needs the scroll area to
// take focus and to have a name a screen reader can announce.

import React from 'react'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'

import { SkipLink, MAIN_CONTENT_ID } from '../SkipLink'
import { CopyCode } from '../CopyCode'

describe('SkipLink', () => {
  it('is the way past the navigation to the main content', () => {
    render(<SkipLink />)
    const link = screen.getByRole('link', { name: 'Skip to content' })
    expect(link).toHaveAttribute('href', `#${MAIN_CONTENT_ID}`)
  })
})

describe('CopyCode', () => {
  it('makes the code a named region the keyboard can reach and scroll', () => {
    render(<CopyCode label="Request" code="curl https://example.test" />)
    const region = screen.getByRole('region', { name: 'Request example' })
    expect(region).toHaveAttribute('tabindex', '0')
    expect(region).toHaveTextContent('curl https://example.test')
  })
})
