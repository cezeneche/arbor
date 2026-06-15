/**
 * @jest-environment jsdom
 */

import React from 'react'
import { render, screen, within, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'

import {
  FilterBar,
  getDefaultFilters,
  getLastCompletedQuarter,
  countActiveFilters,
  buildSqlPreview,
  buildFilterTags,
  quarterToDateRange,
  quarterLabel,
  generateQuarterRange,
} from '../FilterBar'
import type { FilterState } from '@/types/filters'

// ── Pure utility tests (no DOM required) ──────────────────────────────────────

describe('quarterLabel', () => {
  it('formats a quarter value as Q-first display', () => {
    expect(quarterLabel('2026-Q1')).toBe('Q1 2026')
    expect(quarterLabel('2027-Q4')).toBe('Q4 2027')
  })
})

describe('quarterToDateRange', () => {
  it('Q1 starts Jan 01 and ends Mar 31', () => {
    expect(quarterToDateRange('2026-Q1')).toEqual({ start: '2026-01-01', end: '2026-03-31' })
  })
  it('Q2 starts Apr 01 and ends Jun 30', () => {
    expect(quarterToDateRange('2026-Q2')).toEqual({ start: '2026-04-01', end: '2026-06-30' })
  })
  it('Q3 starts Jul 01 and ends Sep 30', () => {
    expect(quarterToDateRange('2026-Q3')).toEqual({ start: '2026-07-01', end: '2026-09-30' })
  })
  it('Q4 starts Oct 01 and ends Dec 31', () => {
    expect(quarterToDateRange('2026-Q4')).toEqual({ start: '2026-10-01', end: '2026-12-31' })
  })
})

describe('generateQuarterRange', () => {
  it('generates all quarters between two values inclusive', () => {
    const result = generateQuarterRange('2025-Q3', '2026-Q2')
    expect(result).toEqual(['2025-Q3', '2025-Q4', '2026-Q1', '2026-Q2'])
  })
  it('single quarter range returns one element', () => {
    expect(generateQuarterRange('2026-Q1', '2026-Q1')).toEqual(['2026-Q1'])
  })
})

describe('getLastCompletedQuarter', () => {
  const RealDate = Date

  afterEach(() => { (global as typeof globalThis).Date = RealDate })

  function mockDate(isoString: string) {
    const fixed = new RealDate(isoString)
    ;(global as typeof globalThis).Date = class extends RealDate {
      constructor(...args: ConstructorParameters<typeof RealDate>) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        super(...(args.length ? args : [fixed.toISOString()]) as [any])
      }
      static now() { return fixed.getTime() }
    } as typeof Date
  }

  it('returns Q4 of previous year when currently in Q1', () => {
    mockDate('2026-02-15')
    expect(getLastCompletedQuarter()).toBe('2025-Q4')
  })
  it('returns Q1 when currently in Q2', () => {
    mockDate('2026-05-01')
    expect(getLastCompletedQuarter()).toBe('2026-Q1')
  })
  it('returns Q2 when currently in Q3', () => {
    mockDate('2026-08-20')
    expect(getLastCompletedQuarter()).toBe('2026-Q2')
  })
  it('returns Q3 when currently in Q4', () => {
    mockDate('2026-11-01')
    expect(getLastCompletedQuarter()).toBe('2026-Q3')
  })
})

describe('getDefaultFilters', () => {
  it('sectors and countries default to empty (All)', () => {
    const d = getDefaultFilters()
    expect(d.sectors).toEqual([])
    expect(d.countries).toEqual([])
  })
  it('all three trust tiers selected by default', () => {
    expect(getDefaultFilters().trustTiers).toEqual(['A', 'B', 'C'])
  })
  it('domain defaults to ENERGY', () => {
    expect(getDefaultFilters().domain).toBe('ENERGY')
  })
  it('period defaults to last completed quarter', () => {
    const d = getDefaultFilters()
    expect(d.periodFrom).toBe(getLastCompletedQuarter())
    expect(d.periodTo).toBe(getLastCompletedQuarter())
  })
})

describe('countActiveFilters', () => {
  it('returns 0 for default state', () => {
    expect(countActiveFilters(getDefaultFilters())).toBe(0)
  })
  it('counts one for each non-default dimension', () => {
    const f = getDefaultFilters()
    expect(countActiveFilters({ ...f, sectors: ['Steel'] })).toBe(1)
    expect(countActiveFilters({ ...f, countries: ['Germany'] })).toBe(1)
    expect(countActiveFilters({ ...f, trustTiers: ['A'] })).toBe(1)
    expect(countActiveFilters({ ...f, domain: 'MATERIALS' })).toBe(1)
  })
  it('counts period as one regardless of range size', () => {
    const f = getDefaultFilters()
    expect(countActiveFilters({ ...f, periodFrom: '2025-Q1', periodTo: '2025-Q4' })).toBe(1)
  })
  it('accumulates correctly across multiple active filters', () => {
    const f: FilterState = {
      ...getDefaultFilters(),
      sectors: ['Steel', 'Aluminium'],
      countries: ['Germany'],
      trustTiers: ['A'],
      domain: 'MATERIALS',
    }
    expect(countActiveFilters(f)).toBe(4)
  })
})

describe('buildSqlPreview', () => {
  it('includes buyer_entity_id predicate', () => {
    const sql = buildSqlPreview(getDefaultFilters(), 'buyer-123')
    expect(sql).toContain("rel.buyer_entity_id = 'buyer-123'")
  })
  it('includes sector IN clause when sectors are selected', () => {
    const f = { ...getDefaultFilters(), sectors: ['Steel', 'Aluminium'] as FilterState['sectors'] }
    expect(buildSqlPreview(f)).toContain("e.sector IN ('Steel', 'Aluminium')")
  })
  it('omits sector WHERE clause when all sectors selected (empty array)', () => {
    expect(buildSqlPreview(getDefaultFilters())).not.toContain('AND e.sector')
  })
  it('includes period_start and period_end predicates', () => {
    const sql = buildSqlPreview({ ...getDefaultFilters(), periodFrom: '2026-Q1', periodTo: '2026-Q1' })
    expect(sql).toContain("r.period_start >= '2026-01-01'")
    expect(sql).toContain("r.period_end <= '2026-03-31'")
  })
  it('includes trust_tier IN when not all tiers selected', () => {
    const f = { ...getDefaultFilters(), trustTiers: ['A'] as FilterState['trustTiers'] }
    expect(buildSqlPreview(f)).toContain("r.trust_tier IN ('A')")
  })
  it('omits trust_tier clause when all three tiers selected', () => {
    expect(buildSqlPreview(getDefaultFilters())).not.toContain('r.trust_tier')
  })
  it('uses the domain enum value unchanged', () => {
    expect(buildSqlPreview(getDefaultFilters())).toContain("r.domain = 'ENERGY'")
  })
  it('always ends with is_active and ORDER BY', () => {
    const sql = buildSqlPreview(getDefaultFilters())
    expect(sql).toContain('AND r.is_active = true')
    expect(sql).toContain('ORDER BY e.legal_name, r.period_start')
  })
})

describe('buildFilterTags', () => {
  it('returns no tags for default state', () => {
    const onChange = jest.fn()
    expect(buildFilterTags(getDefaultFilters(), onChange)).toHaveLength(0)
  })
  it('returns one tag per selected sector', () => {
    const onChange = jest.fn()
    const f = { ...getDefaultFilters(), sectors: ['Steel', 'Aluminium'] as FilterState['sectors'] }
    const tags = buildFilterTags(f, onChange)
    expect(tags.filter(t => t.label === 'Sector')).toHaveLength(2)
  })
  it('removing a sector tag calls onChange with that sector removed', () => {
    const onChange = jest.fn()
    const f = { ...getDefaultFilters(), sectors: ['Steel', 'Aluminium'] as FilterState['sectors'] }
    const tags = buildFilterTags(f, onChange)
    const steelTag = tags.find(t => t.value === 'Steel')!
    steelTag.onRemove()
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ sectors: ['Aluminium'] }))
  })
  it('period tag appears only when period differs from default', () => {
    const onChange = jest.fn()
    const f = { ...getDefaultFilters(), periodFrom: '2025-Q1', periodTo: '2025-Q4' }
    const tags = buildFilterTags(f, onChange)
    expect(tags.some(t => t.label === 'Period')).toBe(true)
  })
  it('shows range format when from ≠ to', () => {
    const onChange = jest.fn()
    const f = { ...getDefaultFilters(), periodFrom: '2025-Q1', periodTo: '2025-Q4' }
    const tags = buildFilterTags(f, onChange)
    const periodTag = tags.find(t => t.label === 'Period')!
    expect(periodTag.value).toBe('Q1 2025 – Q4 2025')
  })
  it('trust tier tags appear only for selected tiers when not all selected', () => {
    const onChange = jest.fn()
    const f = { ...getDefaultFilters(), trustTiers: ['A'] as FilterState['trustTiers'] }
    const tags = buildFilterTags(f, onChange)
    expect(tags.filter(t => t.label === 'Trust tier')).toHaveLength(1)
    expect(tags.find(t => t.label === 'Trust tier')!.value).toBe('Verified')
  })
  it('domain tag appears only when domain is non-default', () => {
    const onChange = jest.fn()
    const f = { ...getDefaultFilters(), domain: 'MATERIALS' as FilterState['domain'] }
    const tags = buildFilterTags(f, onChange)
    expect(tags.some(t => t.label === 'Data type' && t.value === 'Materials')).toBe(true)
  })
})

// ── React component tests ─────────────────────────────────────────────────────

const COUNTRIES = ['Germany', 'France', 'Poland']

function renderFilterBar(overrides: Partial<FilterState> = {}, onChange = jest.fn()) {
  const value: FilterState = { ...getDefaultFilters(), ...overrides }
  return {
    onChange,
    ...render(
      <FilterBar
        supplierCountries={COUNTRIES}
        value={value}
        onChange={onChange}
        buyerId="buyer-123"
      />,
    ),
  }
}

describe('FilterBar — default render', () => {
  it('renders all filter controls', () => {
    renderFilterBar()
    expect(screen.getByText(/Sector/i)).toBeInTheDocument()
    expect(screen.getByText(/Country/i)).toBeInTheDocument()
    expect(screen.getByText(/Period/i)).toBeInTheDocument()
    expect(screen.getByText('Verified')).toBeInTheDocument()
    expect(screen.getByText('Declared')).toBeInTheDocument()
    expect(screen.getByText('Estimated')).toBeInTheDocument()
    expect(screen.getByText(/Data type/i)).toBeInTheDocument()
  })

  it('does not show Clear all when no filters are active', () => {
    renderFilterBar()
    expect(screen.queryByText('Clear all')).not.toBeInTheDocument()
  })

  it('does not show active tags when in default state', () => {
    renderFilterBar()
    // Tags render as "[label]: [value] ×" — none should be present
    expect(screen.queryByLabelText(/^Remove /)).not.toBeInTheDocument()
  })
})

describe('FilterBar — filter application', () => {
  it('calls onChange when a sector is selected', async () => {
    const user = userEvent.setup()
    const onChange = jest.fn()
    renderFilterBar({}, onChange)

    // Open sector dropdown
    await user.click(screen.getByRole('button', { name: /Sector/i }))
    // Click Steel checkbox (accessible name comes from surrounding label text)
    await user.click(screen.getByRole('checkbox', { name: /Steel/i }))

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ sectors: ['Steel'] }),
    )
  })

  it('calls onChange when a trust tier pill is toggled off', async () => {
    const user = userEvent.setup()
    const onChange = jest.fn()
    renderFilterBar({}, onChange)

    await user.click(screen.getByRole('button', { name: 'Estimated' }))

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ trustTiers: expect.not.arrayContaining(['C']) }),
    )
  })

  it('calls onChange when the period from selector changes', async () => {
    const user = userEvent.setup()
    const onChange = jest.fn()
    renderFilterBar({}, onChange)

    await user.selectOptions(screen.getByRole('combobox', { name: /Period from/i }), '2025-Q1')

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ periodFrom: '2025-Q1' }),
    )
  })
})

describe('FilterBar — clear all', () => {
  it('shows Clear all when any filter is active', () => {
    renderFilterBar({ sectors: ['Steel'] })
    expect(screen.getByText('Clear all')).toBeInTheDocument()
  })

  it('clicking Clear all calls onChange with default state', async () => {
    const user = userEvent.setup()
    const onChange = jest.fn()
    renderFilterBar({ sectors: ['Steel'], countries: ['Germany'], domain: 'MATERIALS' }, onChange)

    await user.click(screen.getByText('Clear all'))

    expect(onChange).toHaveBeenCalledWith(getDefaultFilters())
  })

  it('Clear all button is absent after reset to defaults', () => {
    renderFilterBar(getDefaultFilters())
    expect(screen.queryByText('Clear all')).not.toBeInTheDocument()
  })
})

describe('FilterBar — active filter tags', () => {
  it('shows a removable tag for each active sector', () => {
    renderFilterBar({ sectors: ['Steel', 'Aluminium'] })
    expect(screen.getByLabelText('Remove Sector: Steel')).toBeInTheDocument()
    expect(screen.getByLabelText('Remove Sector: Aluminium')).toBeInTheDocument()
  })

  it('clicking a tag × button calls onChange with that filter removed', async () => {
    const user = userEvent.setup()
    const onChange = jest.fn()
    renderFilterBar({ sectors: ['Steel'] }, onChange)

    await user.click(screen.getByLabelText('Remove Sector: Steel'))

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ sectors: [] }),
    )
  })

  it('shows trust tier tags when fewer than all three are selected', () => {
    renderFilterBar({ trustTiers: ['A', 'B'] })
    expect(screen.getByLabelText('Remove Trust tier: Verified')).toBeInTheDocument()
    expect(screen.getByLabelText('Remove Trust tier: Declared')).toBeInTheDocument()
  })

  it('shows a badge on Filters label equal to the active filter count', () => {
    renderFilterBar({ sectors: ['Steel'], countries: ['Germany'] })
    // ActiveBadge renders the count as text
    expect(screen.getByText('2')).toBeInTheDocument()
  })
})

describe('FilterBar — mobile collapse', () => {
  const originalInnerWidth = window.innerWidth

  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 480 })
    // No resize dispatch needed — component reads innerWidth in useEffect on mount
  })

  afterEach(async () => {
    await act(async () => {
      Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: originalInnerWidth })
      window.dispatchEvent(new Event('resize'))
    })
  })

  it('shows the Filter toggle button on mobile', async () => {
    renderFilterBar()
    // findByRole waits for the useEffect to set isMobile=true and re-render
    const btn = await screen.findByRole('button', { name: /^Filter/i })
    expect(btn).toBeInTheDocument()
  })

  it('filter controls are hidden before the toggle is clicked', async () => {
    renderFilterBar()
    await screen.findByRole('button', { name: /^Filter/i })
    const controls = document.getElementById('filter-controls')!
    expect(controls).toHaveStyle({ display: 'none' })
  })

  it('filter controls become visible after clicking the toggle', async () => {
    const user = userEvent.setup()
    renderFilterBar()

    const toggleBtn = await screen.findByRole('button', { name: /^Filter/i })
    await user.click(toggleBtn)

    const controls = document.getElementById('filter-controls')!
    expect(controls).toHaveStyle({ display: 'flex' })
  })

  it('toggle button shows active filter count badge', async () => {
    renderFilterBar({ sectors: ['Steel'] })
    // Button accessible name is "Filter 1" (text + badge), so use /^Filter/i
    const btn = await screen.findByRole('button', { name: /^Filter/i })
    expect(within(btn).getByText('1')).toBeInTheDocument()
  })
})
