'use client'

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { colours, typography, spacing, shadows, trustTierConfig } from '@/lib/design-system'
import type {
  FilterState,
  TrustTier,
  DataDomain,
  SectorOption,
  QuarterValue,
} from '@/types/filters'

// ── Constants ─────────────────────────────────────────────────────────────────

export const SECTOR_OPTIONS: SectorOption[] = [
  'Steel', 'Aluminium', 'Cement', 'Fertiliser', 'Hydrogen', 'Agriculture', 'Other',
]

export const DOMAIN_OPTIONS: { value: DataDomain; label: string }[] = [
  { value: 'ENERGY', label: 'Energy' },
  { value: 'MATERIALS', label: 'Materials' },
  { value: 'PRODUCTION', label: 'Production' },
  { value: 'LOGISTICS', label: 'Logistics' },
  { value: 'EMISSIONS', label: 'Emissions' },
  { value: 'AGRICULTURE', label: 'Agriculture' },
  { value: 'WASTE_AND_WATER', label: 'Waste & Water' },
  { value: 'COMPLIANCE', label: 'Compliance' },
]

const TIER_LABELS: Record<TrustTier, string> = {
  A: 'Verified',
  B: 'Declared',
  C: 'Estimated',
}

const ALL_TIERS: TrustTier[] = ['A', 'B', 'C']
const PERIOD_START = '2025-Q1'
const PERIOD_END = '2027-Q4'

// ── Quarter utilities (exported for testing) ──────────────────────────────────

export function quarterLabel(q: QuarterValue): string {
  const [year, qPart] = q.split('-')
  return `${qPart} ${year}` // "Q1 2026"
}

export function quarterToDateRange(q: QuarterValue): { start: string; end: string } {
  const [year, qPart] = q.split('-')
  const qNum = parseInt(qPart.slice(1), 10)
  const startMonth = (qNum - 1) * 3 + 1
  const endMonth = qNum * 3
  const endDay = endMonth === 3 || endMonth === 12 ? 31 : 30
  const pad = (n: number) => String(n).padStart(2, '0')
  return {
    start: `${year}-${pad(startMonth)}-01`,
    end: `${year}-${pad(endMonth)}-${endDay}`,
  }
}

export function getLastCompletedQuarter(): QuarterValue {
  const now = new Date()
  const month = now.getMonth() // 0-indexed
  const year = now.getFullYear()
  const currentQ = Math.floor(month / 3) + 1 // 1–4
  if (currentQ === 1) return `${year - 1}-Q4`
  return `${year}-Q${currentQ - 1}`
}

export function generateQuarterRange(from: QuarterValue, to: QuarterValue): QuarterValue[] {
  const quarters: QuarterValue[] = []
  const [y, q] = from.split('-')
  let year = parseInt(y, 10)
  let qNum = parseInt(q.slice(1), 10)
  const [toY, toQ] = to.split('-')
  const toYear = parseInt(toY, 10)
  const toQNum = parseInt(toQ.slice(1), 10)

  while (year < toYear || (year === toYear && qNum <= toQNum)) {
    quarters.push(`${year}-Q${qNum}`)
    qNum++
    if (qNum > 4) { qNum = 1; year++ }
  }
  return quarters
}

export const ALL_QUARTERS = generateQuarterRange(PERIOD_START, PERIOD_END)

export function getDefaultFilters(): FilterState {
  const lastQ = getLastCompletedQuarter()
  return {
    sectors: [],
    countries: [],
    periodFrom: lastQ,
    periodTo: lastQ,
    trustTiers: ['A', 'B', 'C'],
    domain: 'ENERGY',
  }
}

export function countActiveFilters(filters: FilterState, defaults = getDefaultFilters()): number {
  let count = 0
  if (filters.sectors.length > 0) count++
  if (filters.countries.length > 0) count++
  if (filters.periodFrom !== defaults.periodFrom || filters.periodTo !== defaults.periodTo) count++
  if (filters.trustTiers.length !== 3) count++
  if (filters.domain !== defaults.domain) count++
  return count
}

// ── SQL preview builder (exported for testing) ────────────────────────────────

export function buildSqlPreview(filters: FilterState, buyerId = '[BUYER_ID]'): string {
  const { sectors, countries, periodFrom, periodTo, trustTiers, domain } = filters
  const { start: pStart } = quarterToDateRange(periodFrom)
  const { end: pEnd } = quarterToDateRange(periodTo)

  const lines = [
    'SELECT r.*, e.legal_name, e.sector, e.country',
    'FROM records r',
    'JOIN entities e ON r.entity_id = e.entity_id',
    'JOIN relationships rel ON rel.supplier_entity_id = e.entity_id',
    `WHERE rel.buyer_entity_id = '${buyerId}'`,
  ]

  if (sectors.length > 0 && sectors.length < SECTOR_OPTIONS.length) {
    lines.push(`AND e.sector IN (${sectors.map(s => `'${s}'`).join(', ')})`)
  }
  if (countries.length > 0) {
    lines.push(`AND e.country IN (${countries.map(c => `'${c}'`).join(', ')})`)
  }
  lines.push(`AND r.period_start >= '${pStart}'`)
  lines.push(`AND r.period_end <= '${pEnd}'`)
  if (trustTiers.length < 3) {
    lines.push(`AND r.trust_tier IN (${trustTiers.map(t => `'${t}'`).join(', ')})`)
  }
  lines.push(`AND r.domain = '${domain}'`)
  lines.push('AND r.is_active = true')
  lines.push('ORDER BY e.legal_name, r.period_start')

  return lines.join('\n')
}

// ── Tag builder ───────────────────────────────────────────────────────────────

type FilterTag = { key: string; label: string; value: string; onRemove: () => void }

export function buildFilterTags(filters: FilterState, onChange: (f: FilterState) => void, defaults = getDefaultFilters()): FilterTag[] {
  const tags: FilterTag[] = []

  for (const s of filters.sectors) {
    tags.push({
      key: `sector-${s}`,
      label: 'Sector',
      value: s,
      onRemove: () => onChange({ ...filters, sectors: filters.sectors.filter(x => x !== s) }),
    })
  }

  for (const c of filters.countries) {
    tags.push({
      key: `country-${c}`,
      label: 'Country',
      value: c,
      onRemove: () => onChange({ ...filters, countries: filters.countries.filter(x => x !== c) }),
    })
  }

  if (filters.periodFrom !== defaults.periodFrom || filters.periodTo !== defaults.periodTo) {
    const periodDisplay =
      filters.periodFrom === filters.periodTo
        ? quarterLabel(filters.periodFrom)
        : `${quarterLabel(filters.periodFrom)} – ${quarterLabel(filters.periodTo)}`
    tags.push({
      key: 'period',
      label: 'Period',
      value: periodDisplay,
      onRemove: () => onChange({ ...filters, periodFrom: defaults.periodFrom, periodTo: defaults.periodTo }),
    })
  }

  if (filters.trustTiers.length < 3) {
    for (const t of filters.trustTiers) {
      tags.push({
        key: `tier-${t}`,
        label: 'Trust tier',
        value: TIER_LABELS[t],
        onRemove: () => {
          const next = filters.trustTiers.filter(x => x !== t)
          // Never leave trust tiers empty - treat removing the last one as "all"
          onChange({ ...filters, trustTiers: next.length === 0 ? ['A', 'B', 'C'] : next })
        },
      })
    }
  }

  if (filters.domain !== defaults.domain) {
    const domainLabel = DOMAIN_OPTIONS.find(d => d.value === filters.domain)?.label ?? filters.domain
    tags.push({
      key: 'domain',
      label: 'Data type',
      value: domainLabel,
      onRemove: () => onChange({ ...filters, domain: defaults.domain }),
    })
  }

  return tags
}

// ── Sub-components ────────────────────────────────────────────────────────────

function useClickOutside(ref: React.RefObject<HTMLElement | null>, onClose: () => void) {
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [ref, onClose])
}

function MultiSelectDropdown<T extends string>({
  id,
  label,
  options,
  selected,
  onChange,
}: {
  id: string
  label: string
  options: T[]
  selected: T[]
  onChange: (vals: T[]) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])
  useClickOutside(ref, close)

  const toggle = (val: T) =>
    selected.includes(val)
      ? onChange(selected.filter(v => v !== val))
      : onChange([...selected, val])

  const displayLabel =
    selected.length === 0 ? 'All'
    : selected.length === 1 ? selected[0]
    : `${selected.length} selected`

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        id={id}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '7px 12px',
          backgroundColor: selected.length > 0 ? colours.navy : colours.surface,
          color: selected.length > 0 ? colours.surface : colours.textPrimary,
          border: `1px solid ${selected.length > 0 ? colours.navy : colours.border}`,
          borderRadius: '4px',
          fontSize: typography.sizes.sm,
          fontWeight: selected.length > 0 ? typography.weights.medium : typography.weights.light,
          cursor: 'pointer',
          fontFamily: typography.fontFamily,
          whiteSpace: 'nowrap',
        }}
      >
        <span
          style={{
            fontSize: typography.sizes.xs,
            fontWeight: typography.weights.medium,
            color: selected.length > 0 ? colours.surface : colours.textTertiary,
            letterSpacing: typography.tracking.wider,
            textTransform: 'uppercase',
            marginRight: '2px',
          }}
        >
          {label}
        </span>
        {displayLabel}
        <span style={{ marginLeft: '2px', opacity: 0.5 }}>{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <div
          role="listbox"
          aria-multiselectable="true"
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            zIndex: 100,
            backgroundColor: colours.surface,
            border: `1px solid ${colours.border}`,
            borderRadius: '6px',
            boxShadow: shadows.dropdown,
            minWidth: '180px',
            padding: '6px 0',
          }}
        >
          {options.length === 0 ? (
            <div
              style={{
                padding: '8px 14px',
                fontSize: typography.sizes.sm,
                fontWeight: typography.weights.light,
                color: colours.textTertiary,
              }}
            >
              No options available
            </div>
          ) : null}
          {options.map(opt => {
            const checked = selected.includes(opt)
            return (
              <label
                key={opt}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '8px 14px',
                  cursor: 'pointer',
                  backgroundColor: checked ? colours.background : 'transparent',
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(opt)}
                  style={{ accentColor: colours.navy }}
                />
                <span
                  style={{
                    fontSize: typography.sizes.sm,
                    fontWeight: checked ? typography.weights.medium : typography.weights.light,
                    color: colours.textPrimary,
                  }}
                >
                  {opt}
                </span>
              </label>
            )
          })}

          {selected.length > 0 && (
            <div style={{ borderTop: `1px solid ${colours.border}`, margin: '4px 0 0', padding: '6px 14px 2px' }}>
              <button
                onClick={() => onChange([])}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  fontSize: typography.sizes.xs,
                  fontWeight: typography.weights.light,
                  color: colours.textSecondary,
                  cursor: 'pointer',
                  fontFamily: typography.fontFamily,
                }}
              >
                Clear
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function SingleSelectDropdown({
  id,
  label,
  options,
  value,
  onChange,
}: {
  id: string
  label: string
  options: { value: string; label: string }[]
  value: string
  onChange: (val: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])
  useClickOutside(ref, close)

  const displayLabel = options.find(o => o.value === value)?.label ?? value

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        id={id}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '7px 12px',
          backgroundColor: colours.surface,
          color: colours.textPrimary,
          border: `1px solid ${colours.border}`,
          borderRadius: '4px',
          fontSize: typography.sizes.sm,
          fontWeight: typography.weights.light,
          cursor: 'pointer',
          fontFamily: typography.fontFamily,
          whiteSpace: 'nowrap',
        }}
      >
        <span
          style={{
            fontSize: typography.sizes.xs,
            fontWeight: typography.weights.medium,
            color: colours.textTertiary,
            letterSpacing: typography.tracking.wider,
            textTransform: 'uppercase',
            marginRight: '2px',
          }}
        >
          {label}
        </span>
        {displayLabel}
        <span style={{ marginLeft: '2px', opacity: 0.5 }}>{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <div
          role="listbox"
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            zIndex: 100,
            backgroundColor: colours.surface,
            border: `1px solid ${colours.border}`,
            borderRadius: '6px',
            boxShadow: shadows.dropdown,
            minWidth: '180px',
            padding: '6px 0',
          }}
        >
          {options.map(opt => {
            const active = opt.value === value
            return (
              <button
                key={opt.value}
                role="option"
                aria-selected={active}
                onClick={() => { onChange(opt.value); setOpen(false) }}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '8px 14px',
                  background: active ? colours.background : 'none',
                  border: 'none',
                  fontSize: typography.sizes.sm,
                  fontWeight: active ? typography.weights.medium : typography.weights.light,
                  color: active ? colours.navy : colours.textPrimary,
                  cursor: 'pointer',
                  fontFamily: typography.fontFamily,
                }}
              >
                {opt.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function TrustTierPills({
  selected,
  onChange,
}: {
  selected: TrustTier[]
  onChange: (tiers: TrustTier[]) => void
}) {
  const toggle = (tier: TrustTier) => {
    const next = selected.includes(tier)
      ? selected.filter(t => t !== tier)
      : [...selected, tier].sort() as TrustTier[]
    // Never leave empty - if last tier is removed, restore all
    onChange(next.length === 0 ? ALL_TIERS : next)
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0',
        border: `1px solid ${colours.border}`,
        borderRadius: '4px',
        overflow: 'hidden',
      }}
    >
      {ALL_TIERS.map((tier, i) => {
        const active = selected.includes(tier)
        const cfg = trustTierConfig[tier]
        return (
          <button
            key={tier}
            aria-pressed={active}
            onClick={() => toggle(tier)}
            style={{
              padding: '7px 12px',
              border: 'none',
              borderLeft: i > 0 ? `1px solid ${active ? colours.navy : colours.border}` : 'none',
              backgroundColor: active ? colours.navy : colours.surface,
              color: active ? colours.surface : colours.textSecondary,
              fontSize: typography.sizes.sm,
              fontWeight: active ? typography.weights.medium : typography.weights.light,
              cursor: 'pointer',
              fontFamily: typography.fontFamily,
              whiteSpace: 'nowrap',
              transition: 'background-color 0.1s, color 0.1s',
            }}
            title={cfg.description}
          >
            {TIER_LABELS[tier]}
          </button>
        )
      })}
    </div>
  )
}

function PeriodPicker({
  from,
  to,
  onChange,
}: {
  from: QuarterValue
  to: QuarterValue
  onChange: (from: QuarterValue, to: QuarterValue) => void
}) {
  const handleFrom = (val: QuarterValue) => {
    // If new from > to, snap to to also becoming from
    const fromIndex = ALL_QUARTERS.indexOf(val)
    const toIndex = ALL_QUARTERS.indexOf(to)
    onChange(val, fromIndex > toIndex ? val : to)
  }

  const handleTo = (val: QuarterValue) => {
    const fromIndex = ALL_QUARTERS.indexOf(from)
    const toIndex = ALL_QUARTERS.indexOf(val)
    onChange(toIndex < fromIndex ? val : from, val)
  }

  const selectStyle: React.CSSProperties = {
    padding: '7px 10px',
    backgroundColor: colours.surface,
    color: colours.textPrimary,
    border: `1px solid ${colours.border}`,
    borderRadius: '4px',
    fontSize: typography.sizes.sm,
    fontWeight: typography.weights.light,
    cursor: 'pointer',
    fontFamily: typography.fontFamily,
    appearance: 'none',
    paddingRight: '28px',
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%23A0A09A' fill='none' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E")`,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'right 10px center',
  }

  const fromOptions = ALL_QUARTERS
  const fromIdx = ALL_QUARTERS.indexOf(from)
  const toOptions = fromIdx >= 0 ? ALL_QUARTERS.slice(fromIdx) : ALL_QUARTERS

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
      <span
        style={{
          fontSize: typography.sizes.xs,
          fontWeight: typography.weights.medium,
          color: colours.textTertiary,
          letterSpacing: typography.tracking.wider,
          textTransform: 'uppercase',
          whiteSpace: 'nowrap',
        }}
      >
        Period
      </span>
      <select
        aria-label="Period from"
        value={from}
        onChange={e => handleFrom(e.target.value)}
        style={selectStyle}
      >
        {fromOptions.map(q => (
          <option key={q} value={q}>{quarterLabel(q)}</option>
        ))}
      </select>
      <span
        style={{
          fontSize: typography.sizes.xs,
          fontWeight: typography.weights.light,
          color: colours.textTertiary,
        }}
      >
        –
      </span>
      <select
        aria-label="Period to"
        value={to}
        onChange={e => handleTo(e.target.value)}
        style={selectStyle}
      >
        {toOptions.map(q => (
          <option key={q} value={q}>{quarterLabel(q)}</option>
        ))}
      </select>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export interface FilterBarProps {
  supplierCountries: string[]
  value: FilterState
  onChange: (next: FilterState) => void
  /** Buyer entity ID - used only in the development SQL preview. */
  buyerId?: string
}

export function FilterBar({ supplierCountries, value, onChange, buyerId }: FilterBarProps) {
  const [mobileExpanded, setMobileExpanded] = useState(false)
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  const pinnedDefaults = useMemo(() => getDefaultFilters(), [])
  const activeCount = countActiveFilters(value, pinnedDefaults)
  const tags = buildFilterTags(value, onChange, pinnedDefaults)
  const showFilters = !isMobile || mobileExpanded

  const clearAll = useCallback(() => onChange(pinnedDefaults), [onChange, pinnedDefaults])

  return (
    <div>
      {/* Mobile toggle row */}
      {isMobile && (
        <div style={{ marginBottom: spacing[1] }}>
          <button
            aria-expanded={mobileExpanded}
            aria-controls="filter-controls"
            onClick={() => setMobileExpanded(v => !v)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 14px',
              backgroundColor: colours.surface,
              border: `1px solid ${colours.border}`,
              borderRadius: '4px',
              fontSize: typography.sizes.sm,
              fontWeight: typography.weights.medium,
              color: colours.textPrimary,
              cursor: 'pointer',
              fontFamily: typography.fontFamily,
            }}
          >
            Filter
            {activeCount > 0 && <ActiveBadge count={activeCount} />}
          </button>
        </div>
      )}

      {/* Filter controls */}
      <div
        id="filter-controls"
        style={{
          display: showFilters ? 'flex' : 'none',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: '8px',
          padding: `${spacing[2]} ${spacing[2]}`,
          backgroundColor: colours.surface,
          border: `1px solid ${colours.border}`,
          borderRadius: '6px',
        }}
      >
        {/* Filters label + badge (desktop only) */}
        {!isMobile && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginRight: '4px' }}>
            <span
              style={{
                fontSize: typography.sizes.xs,
                fontWeight: typography.weights.medium,
                color: colours.textTertiary,
                letterSpacing: typography.tracking.wider,
                textTransform: 'uppercase',
              }}
            >
              Filters
            </span>
            {activeCount > 0 && <ActiveBadge count={activeCount} />}
          </div>
        )}

        {/* Sector */}
        <MultiSelectDropdown
          id="filter-sector"
          label="Sector"
          options={SECTOR_OPTIONS}
          selected={value.sectors}
          onChange={sectors => onChange({ ...value, sectors })}
        />

        {/* Country */}
        <MultiSelectDropdown
          id="filter-country"
          label="Country"
          options={supplierCountries}
          selected={value.countries}
          onChange={countries => onChange({ ...value, countries })}
        />

        {/* Period */}
        <PeriodPicker
          from={value.periodFrom}
          to={value.periodTo}
          onChange={(periodFrom, periodTo) => onChange({ ...value, periodFrom, periodTo })}
        />

        {/* Trust tier */}
        <TrustTierPills
          selected={value.trustTiers}
          onChange={trustTiers => onChange({ ...value, trustTiers })}
        />

        {/* Domain */}
        <SingleSelectDropdown
          id="filter-domain"
          label="Data type"
          options={DOMAIN_OPTIONS}
          value={value.domain}
          onChange={domain => onChange({ ...value, domain: domain as DataDomain })}
        />

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Clear all */}
        {activeCount > 0 && (
          <button
            onClick={clearAll}
            style={{
              background: 'none',
              border: 'none',
              padding: '4px 0',
              fontSize: typography.sizes.sm,
              fontWeight: typography.weights.light,
              color: colours.textSecondary,
              cursor: 'pointer',
              fontFamily: typography.fontFamily,
              textDecoration: 'underline',
              textUnderlineOffset: '2px',
              whiteSpace: 'nowrap',
            }}
          >
            Clear all
          </button>
        )}
      </div>

      {/* Active filter tags */}
      {tags.length > 0 && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '6px',
            marginTop: '8px',
          }}
        >
          {tags.map(tag => (
            <span
              key={tag.key}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                padding: '3px 8px 3px 10px',
                backgroundColor: colours.background,
                border: `1px solid ${colours.border}`,
                borderRadius: '100px',
                fontSize: typography.sizes.xs,
                fontWeight: typography.weights.light,
                color: colours.textPrimary,
              }}
            >
              <span style={{ color: colours.textTertiary }}>{tag.label}:</span>
              {tag.value}
              <button
                aria-label={`Remove ${tag.label}: ${tag.value}`}
                onClick={tag.onRemove}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: '0 0 0 2px',
                  fontSize: typography.sizes.xs,
                  color: colours.textTertiary,
                  cursor: 'pointer',
                  lineHeight: 1,
                  fontFamily: typography.fontFamily,
                }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {/* SQL preview - development only */}
      {process.env.NODE_ENV === 'development' && (
        <pre
          style={{
            marginTop: spacing[2],
            padding: spacing[2],
            backgroundColor: colours.background,
            border: `1px solid ${colours.border}`,
            borderRadius: '4px',
            fontSize: typography.sizes.xs,
            fontWeight: typography.weights.light,
            color: colours.textSecondary,
            overflowX: 'auto',
            lineHeight: 1.6,
            fontFamily: 'monospace',
          }}
        >
          {buildSqlPreview(value, buyerId)}
        </pre>
      )}
    </div>
  )
}

function ActiveBadge({ count }: { count: number }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: '18px',
        height: '18px',
        padding: '0 5px',
        backgroundColor: colours.navy,
        color: colours.surface,
        borderRadius: '100px',
        fontSize: typography.sizes.xs,
        fontWeight: typography.weights.medium,
        lineHeight: 1,
      }}
    >
      {count}
    </span>
  )
}
