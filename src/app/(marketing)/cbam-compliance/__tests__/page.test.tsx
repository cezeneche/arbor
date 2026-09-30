/** @jest-environment jsdom */
import React from 'react'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import CbamCompliancePage from '../page'

// The CBAM page makes regulatory and product claims in public. These pin the
// ones that must not drift: the dates checked against GOV.UK, the boundary
// between preparing a return and submitting it, and relief's verification rule.

describe('CBAM compliance page', () => {
  beforeEach(() => render(<CbamCompliancePage />))

  it('states the UK dates as HMRC gives them', () => {
    expect(screen.getAllByText(/1 January 2027/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/31 May 2028/).length).toBeGreaterThan(0)
  })

  it('says Arbor prepares the return and the importer submits it', () => {
    expect(screen.getAllByText(/Arbor does not submit/i).length).toBeGreaterThan(0)
  })

  it('says relief counts only with a verifier’s statement', () => {
    expect(screen.getAllByText(/verifier’s statement/i).length).toBeGreaterThan(0)
    expect(screen.getByText(/only counts once/i)).toBeInTheDocument()
  })

  it('sends importers to the importer request form', () => {
    const links = screen.getAllByRole('link', { name: /request pilot access/i })
    expect(links.length).toBeGreaterThan(0)
    for (const link of links) expect(link).toHaveAttribute('href', '/request-access?audience=importer')
  })

  it('gives no EU deadline it could not check', () => {
    expect(screen.queryByText(/31 August 2027|30 September 2027/)).not.toBeInTheDocument()
  })
})
