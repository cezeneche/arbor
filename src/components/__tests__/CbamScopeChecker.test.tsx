/**
 * @jest-environment jsdom
 */

// The scope check as an importer sees it. It asks for a commodity code and
// answers from that alone: a covered code is "in scope", with the estimate, and
// with the exemption threshold for the regime they file under. It used to say
// "needs a closer look" for every covered code, because Nucleos wants an origin
// and an EORI this screen never asks for.

import React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'

import { CbamScopeChecker } from '../CbamScopeChecker'

// What Nucleos returns for a code alone.
const steel = {
  status: 'requires_review',
  sector: 'iron_steel',
  cn_code: '72081000',
  origin_country: null,
  importer_eori: null,
  reasons: [
    'annex_i:covered:72081000:sector=iron_steel — CN code is covered by CBAM Annex I (EU 2023/956, Annex I)',
    'origin:missing — origin country not provided; cannot confirm Annex II exclusion or third-country status',
    'de_minimis:annual_mass_threshold:50t — an importer is exempt only if its iron and steel, aluminium, fertiliser and cement imports total 50 tonnes or less in the calendar year',
    'eori:missing — importer EORI not provided',
  ],
  regulation_refs: ['EU Regulation 2023/956, Annex I (covered goods and CN codes)'],
  default_see_tco2e_per_t: 1.89,
}

const fetchMock = jest.fn()
beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => steel })
  global.fetch = fetchMock as unknown as typeof fetch
})

async function checkCode(jurisdiction: 'UK' | 'EU' | 'BOTH') {
  render(<CbamScopeChecker jurisdiction={jurisdiction} />)
  await userEvent.type(screen.getByPlaceholderText(/8 digits/), '72081000')
  await userEvent.click(screen.getByRole('button'))
  await screen.findByText(/in scope/i)
}

describe('CbamScopeChecker', () => {
  it('answers in scope from the code alone, not "needs a closer look"', async () => {
    await checkCode('UK')
    expect(screen.getByText('These goods are in scope')).toBeInTheDocument()
    expect(screen.queryByText(/closer look/i)).not.toBeInTheDocument()
  })

  it('does not reproach the user for inputs it never asked for', async () => {
    await checkCode('UK')
    expect(screen.queryByText(/origin country not provided/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/EORI not provided/i)).not.toBeInTheDocument()
  })

  it('gives a UK importer the £50,000 threshold', async () => {
    await checkCode('UK')
    expect(screen.getByText(/£50,000 or more of CBAM goods/)).toBeInTheDocument()
    expect(screen.queryByText(/50 tonnes or less/)).not.toBeInTheDocument()
  })

  it('gives an EU importer the 50-tonne exemption', async () => {
    await checkCode('EU')
    expect(screen.getByText(/50 tonnes or less in total/)).toBeInTheDocument()
    expect(screen.queryByText(/£50,000/)).not.toBeInTheDocument()
  })

  it('does not promise that a declaration will be required', async () => {
    await checkCode('EU')
    expect(screen.queryByText(/will be required/i)).not.toBeInTheDocument()
  })

  it('tells a UK-only importer that electricity is out of scope', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        ...steel,
        sector: 'electricity',
        cn_code: '27160000',
        reasons: [
          'annex_i:covered:27160000:sector=electricity — CN code is covered by CBAM Annex I',
          'origin:missing — origin country not provided',
          'de_minimis:not_available:electricity — the 50-tonne annual exemption does not cover electricity',
          'eori:missing — importer EORI not provided',
        ],
      }),
    })
    render(<CbamScopeChecker jurisdiction="UK" />)
    await userEvent.type(screen.getByPlaceholderText(/8 digits/), '27160000')
    await userEvent.click(screen.getByRole('button'))
    expect(await screen.findByText('These goods are out of scope')).toBeInTheDocument()
    expect(screen.getByText('UK CBAM does not cover electricity.')).toBeInTheDocument()
  })

  it('offers the estimate once a tonnage is given', async () => {
    await checkCode('UK')
    expect(screen.getByText(/Enter your annual tonnage above/)).toBeInTheDocument()
  })
})
