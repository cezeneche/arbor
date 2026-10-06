/**
 * @jest-environment jsdom
 */

// The tier the review screen shows must be the tier the record is saved at
// (code review R1). The screen used to predict it without the reporting-period
// end, so a certificate that expired inside its period showed Verified and
// saved Declared: the confirm route passes the period end, and the policy
// refuses an expired certificate for it.

import React from 'react'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'

jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh: jest.fn(), push: jest.fn() }) }))

import { ExtractionReview } from '../ExtractionReview'

function field(fieldName: string, rawValue: string, rawUnit: string | null = null) {
  return {
    id: fieldName,
    fieldName,
    admissibility: 'COMPULSORY' as const,
    rawValue,
    rawUnit,
    sourceText: `${fieldName}: ${rawValue}`,
    confidenceScore: 0.97,
    flagged: false,
    flagReason: null,
  }
}

function certificate(expiry: string) {
  return {
    id: 'doc-1',
    fileName: 'rego.pdf',
    documentType: 'RENEWABLE_CERTIFICATE',
    status: 'REVIEW_REQUIRED',
    extractionJobs: [
      {
        id: 'job-1',
        status: 'COMPLETE' as const,
        errorMessage: null,
        extractedFields: [
          field('certificate_type', 'REGO'),
          field('issuing_body', 'Ofgem'),
          field('certificate_number', 'R-0001'),
          field('holder_name', 'Acme Steel Ltd'),
          field('vintage_year', '2025'),
          field('quantity_mwh', '120', 'MWh'),
          field('technology_type', 'Wind'),
          field('generation_country', 'GB'),
          field('expiry_date', expiry),
        ],
      },
    ],
  }
}

describe('ExtractionReview tier', () => {
  it('shows Declared for a certificate that expired inside its period, as the save does', () => {
    render(<ExtractionReview document={certificate('2025-06-30')} entityName="Acme Steel Ltd" />)
    expect(screen.getByText(/Declared/)).toBeInTheDocument()
    expect(screen.queryByText(/Verified/)).not.toBeInTheDocument()
  })

  it('shows Verified for one valid through its period', () => {
    render(<ExtractionReview document={certificate('2026-12-31')} entityName="Acme Steel Ltd" />)
    expect(screen.getByText(/A · Verified/)).toBeInTheDocument()
  })
})
