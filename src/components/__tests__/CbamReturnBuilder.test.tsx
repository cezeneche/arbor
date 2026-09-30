/**
 * @jest-environment jsdom
 */

// What the return builder says each file is. The EU file is Nucleos's own
// layout of the declaration's figures: the Commission has published no upload
// schema for the annual declaration, and the file does not validate against
// the only one it has published (the transitional quarterly report, v18.30).
// So the tile must not say the file is lodged with the registry, and the EU
// declaration is annual, not quarterly.

import React from 'react'
import { render } from '@testing-library/react'
import '@testing-library/jest-dom'

import { CbamReturnBuilder } from '../CbamReturnBuilder'

describe('CbamReturnBuilder — EU declaration wording', () => {
  function euTile() {
    const { container } = render(
      <CbamReturnBuilder caseId="case-1" available={['EU_XML']} blocked={null} />,
    )
    return container
  }

  it('does not call the EU declaration quarterly', () => {
    expect(euTile()).not.toHaveTextContent(/quarterly/i)
  })

  it('does not claim the file is lodged with the EU registry', () => {
    expect(euTile()).not.toHaveTextContent(/lodge/i)
  })

  it('says the file is not in the registry upload format', () => {
    expect(euTile()).toHaveTextContent(/not in the EU registry.s upload format/i)
  })
})
