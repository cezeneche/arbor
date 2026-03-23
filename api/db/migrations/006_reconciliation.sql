-- Migration 006: Quarterly reconciliation and supplier SEE history tables
--
-- Implements storage for:
--   B1 — Quarterly reconciliation snapshots (cached results for audit trail)
--   B2 — Supplier-level SEE history (rolling 12-month data per supplier+CN code)
--   B3 — Carbon price paid per case (Art. 9 deduction source value)
--
-- Regulation: EU 2023/956 Arts. 9, 21, 22(5); Commission Implementing Reg. 2023/1773 Art. 3

-- ── B3: Add carbon_price_paid_eur column to cbam_cases ─────────────────────
-- Stores the effective carbon price already paid in the origin country (EUR/tCO2e).
-- Zero or NULL means no Art. 9 claim.

ALTER TABLE cbam.cbam_cases
    ADD COLUMN IF NOT EXISTS carbon_price_paid_eur NUMERIC DEFAULT 0,
    ADD COLUMN IF NOT EXISTS carbon_pricing_scheme  TEXT;

COMMENT ON COLUMN cbam.cbam_cases.carbon_price_paid_eur IS
    'Art. 9 deduction: carbon price paid in origin country (EUR/tCO2e). 0 = no deduction.';
COMMENT ON COLUMN cbam.cbam_cases.carbon_pricing_scheme IS
    'Name of the third-country carbon pricing scheme (e.g. UK ETS). NULL if none.';

-- ── B2: Supplier SEE history ────────────────────────────────────────────────
-- One row per (tenant, importer, supplier, cn_code, reporting_period).
-- Populated by the quarterly reconciliation endpoint after each accepted case.

CREATE TABLE IF NOT EXISTS cbam.supplier_see_history (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        TEXT        NOT NULL DEFAULT '',
    importer_eori    TEXT        NOT NULL,
    supplier_eori    TEXT        NOT NULL,
    cn_code          TEXT        NOT NULL,
    see_tco2e_per_t  NUMERIC     NOT NULL,
    reporting_period DATE        NOT NULL,   -- first day of the reporting quarter
    case_id          UUID        REFERENCES cbam.cbam_cases(id) ON DELETE SET NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (tenant_id, importer_eori, supplier_eori, cn_code, reporting_period)
);

CREATE INDEX IF NOT EXISTS idx_supplier_see_history_lookup
    ON cbam.supplier_see_history (tenant_id, importer_eori, supplier_eori, cn_code);

CREATE INDEX IF NOT EXISTS idx_supplier_see_history_period
    ON cbam.supplier_see_history (reporting_period DESC);

COMMENT ON TABLE cbam.supplier_see_history IS
    'Rolling SEE values per supplier+CN code used for B2 cross-invoice consistency checks.';

-- ── B1: Quarterly reconciliation snapshots ──────────────────────────────────
-- Persists the result of each reconcile_quarter() call for audit trail.
-- One row per (tenant, importer, year, quarter) — replaced on re-run.

CREATE TABLE IF NOT EXISTS cbam.quarterly_reconciliation (
    id                                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                         TEXT        NOT NULL DEFAULT '',
    importer_eori                     TEXT        NOT NULL,
    reporting_year                    INT         NOT NULL,
    reporting_quarter                 INT         NOT NULL CHECK (reporting_quarter BETWEEN 1 AND 4),

    -- Aggregated emission totals
    case_count                        INT         NOT NULL DEFAULT 0,
    shipment_count                    INT         NOT NULL DEFAULT 0,
    goods_line_count                  INT         NOT NULL DEFAULT 0,
    total_net_mass_t                  NUMERIC,
    total_direct_tco2e                NUMERIC,
    total_indirect_tco2e              NUMERIC,
    total_embedded_tco2e              NUMERIC,

    -- Art. 9 deduction and certificate requirement
    total_carbon_price_deduction_tco2e NUMERIC    DEFAULT 0,
    net_liability_tco2e               NUMERIC,
    cbam_certificates_required        INT,

    -- Financial exposure (optional — depends on eu_ets_price supplied at run time)
    eu_ets_price_eur                  NUMERIC,
    gross_financial_liability_eur     NUMERIC,
    net_financial_liability_eur       NUMERIC,

    -- Flags (JSON arrays)
    supplier_see_flags                JSONB       NOT NULL DEFAULT '[]',
    carbon_price_flags                JSONB       NOT NULL DEFAULT '[]',

    -- Audit
    case_ids                          TEXT[]      NOT NULL DEFAULT '{}',
    computed_at                       TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (tenant_id, importer_eori, reporting_year, reporting_quarter)
);

CREATE INDEX IF NOT EXISTS idx_quarterly_reconciliation_lookup
    ON cbam.quarterly_reconciliation (tenant_id, importer_eori, reporting_year, reporting_quarter);

COMMENT ON TABLE cbam.quarterly_reconciliation IS
    'Cached quarterly reconciliation results for audit trail and re-use (EU 2023/956 Arts. 21–22).';
