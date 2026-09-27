import { buildSystemPrompt, describeSuppliers } from '../nl-parser'

// The parser was asked for a supplier id and never told any, so a named
// supplier could only be answered with an invented id — which failed the
// authorisation check and widened the search to every supplier.
describe('the parser is told which suppliers exist', () => {
  const suppliers = [
    { id: 'sup-a', name: 'Acme Steel Ltd' },
    { id: 'sup-b', name: 'Northern Freight Limited' },
  ]

  it('lists every authorised supplier with its id', () => {
    const text = describeSuppliers(suppliers)
    expect(text).toContain('Acme Steel Ltd → sup-a')
    expect(text).toContain('Northern Freight Limited → sup-b')
  })

  it('says there are none rather than leaving the model to guess', () => {
    expect(describeSuppliers([])).toMatch(/none/i)
  })

  it('puts the list in the prompt and asks for the name as written', () => {
    const prompt = buildSystemPrompt('2026-09-27', [], suppliers)
    expect(prompt).toContain('Acme Steel Ltd → sup-a')
    expect(prompt).toMatch(/supplierName/)
    expect(prompt).toMatch(/Never invent a supplierEntityId/)
  })
})
