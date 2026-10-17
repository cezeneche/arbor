/** @jest-environment jsdom */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { DocumentHistory } from '../DocumentHistory'
import { prisma } from '@/lib/prisma'

jest.mock('@/lib/prisma', () => ({ prisma: { document: { findMany: jest.fn(), count: jest.fn() } } }))
jest.mock('../overview/Dashboard.module.css', () => ({}))
jest.mock('../overview/Dashboard', () => ({ dashboardTokens: {} }))

const findMany = jest.mocked(prisma.document.findMany)
const count = jest.mocked(prisma.document.count)

beforeEach(() => {
  jest.clearAllMocks()
  findMany.mockResolvedValue([])
  count.mockResolvedValue(0)
})

it('keeps document history collapsed initially and scopes its query to the organisation', async () => {
  const { container } = render(await DocumentHistory({ entityId: 'our-org', page: 1, open: false }))
  expect(container.querySelector('summary')).toHaveTextContent('Documents')
  expect(container.querySelector('details')).not.toHaveAttribute('open')
  expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { entityId: 'our-org' }, skip: 0 }))
})

it('keeps history open when navigating pages and retains the review workflow', async () => {
  count.mockResolvedValue(100)
  const { container } = render(await DocumentHistory({ entityId: 'our-org', page: 2, open: true }))
  expect(container.querySelector('details')).toHaveAttribute('open')
  expect(screen.getByRole('link', { name: 'Open review queue →' })).toHaveAttribute('href', '/review')
  expect(screen.getByRole('link', { name: /previous/i })).toHaveAttribute(
    'href',
    '/upload?documents=open&page=1',
  )
})
