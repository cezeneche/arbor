-- Migration 010: Carbon Price Relief (CPR) tables
-- ---------------------------------------------------------------------------
-- UK CBAM Finance No.2 Bill 2025-26 / Secondary Legislation February 2026
--
-- CPR allows importers to reduce their CBAM liability by the amount of
-- qualifying carbon price already paid in the goods' country of origin.
--
-- Three tables:
--
--   cbam_qualifying_schemes  — reference table of recognised CPR schemes,
--                              pre-seeded with EU ETS participants + EEA + CH.
--                              Updated as HMRC publishes the official UK list.
--
--   cbam_exchange_rates      — HMRC-published monthly reference rates for
--                              converting local carbon prices to GBP.
--                              Seeded with representative Q1 2026 rates;
--                              update quarterly from the HMRC CDRM rate table.
--
--   cbam_cpr_claims          — per-goods-line CPR calculation records with
--                              full intermediate values for audit trail and
--                              references to the accredited verifier document.
-- ---------------------------------------------------------------------------


-- ===========================================================================
-- 1. cbam_qualifying_schemes — reference table
-- ===========================================================================

CREATE TABLE IF NOT EXISTS cbam.cbam_qualifying_schemes (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    country_code        CHAR(2)      NOT NULL,
    scheme_name         VARCHAR(200) NOT NULL,
    scheme_type         VARCHAR(20)  NOT NULL
                            CHECK (scheme_type IN ('ets', 'carbon_tax', 'hybrid')),
    recognition_status  VARCHAR(25)  NOT NULL DEFAULT 'confirmed'
                            CHECK (recognition_status IN ('confirmed', 'pending', 'not_recognised')),
    effective_from      DATE,           -- NULL = from scheme inception
    effective_to        DATE,           -- NULL = still active
    notes               TEXT,
    UNIQUE (country_code, scheme_name)
);

CREATE INDEX IF NOT EXISTS idx_qualifying_schemes_country
    ON cbam.cbam_qualifying_schemes (country_code, recognition_status);

COMMENT ON TABLE cbam.cbam_qualifying_schemes IS
    'Reference table of third-country carbon pricing schemes recognised for '
    'UK CBAM Carbon Price Relief (CPR) purposes. '
    'Source: HMRC CBAM guidance (secondary legislation February 2026). '
    'Pre-seeded with EU ETS participants; update as HMRC publishes the '
    'official UK-specific qualifying list.';

COMMENT ON COLUMN cbam.cbam_qualifying_schemes.recognition_status IS
    'confirmed        — HMRC has confirmed CPR eligibility for this scheme. '
    'pending          — recognition under discussion; CPR cannot yet be claimed. '
    'not_recognised   — scheme exists but HMRC has explicitly excluded it.';


-- ---------------------------------------------------------------------------
-- 1a. Seed qualifying schemes
-- ---------------------------------------------------------------------------
-- EU ETS participants (full participation — recognition_status = confirmed)
-- Source: EU ETS Directive 2003/87/EC as amended; EEA Agreement Annex XX.
-- Note: UK–EU ETS formal linking is still under negotiation (2026). For now,
-- EU ETS installations are 'confirmed' for CPR because the EU ETS is a
-- recognised carbon pricing arrangement meeting the UK CPR criteria.
-- If formal linking is agreed, the exchange-rate calculation methodology
-- may change; flag added as notes field.
-- ---------------------------------------------------------------------------

INSERT INTO cbam.cbam_qualifying_schemes
    (country_code, scheme_name, scheme_type, recognition_status, notes)
VALUES
    -- EU Member States — EU Emissions Trading System
    ('AT', 'EU Emissions Trading System (EU ETS)', 'ets', 'confirmed', 'Full EU ETS participant. Art. 3 Directive 2003/87/EC.'),
    ('BE', 'EU Emissions Trading System (EU ETS)', 'ets', 'confirmed', 'Full EU ETS participant.'),
    ('BG', 'EU Emissions Trading System (EU ETS)', 'ets', 'confirmed', 'Full EU ETS participant.'),
    ('CY', 'EU Emissions Trading System (EU ETS)', 'ets', 'confirmed', 'Full EU ETS participant.'),
    ('CZ', 'EU Emissions Trading System (EU ETS)', 'ets', 'confirmed', 'Full EU ETS participant.'),
    ('DE', 'EU Emissions Trading System (EU ETS)', 'ets', 'confirmed', 'Full EU ETS participant.'),
    ('DK', 'EU Emissions Trading System (EU ETS)', 'ets', 'confirmed', 'Full EU ETS participant.'),
    ('EE', 'EU Emissions Trading System (EU ETS)', 'ets', 'confirmed', 'Full EU ETS participant.'),
    ('ES', 'EU Emissions Trading System (EU ETS)', 'ets', 'confirmed', 'Full EU ETS participant.'),
    ('FI', 'EU Emissions Trading System (EU ETS)', 'ets', 'confirmed', 'Full EU ETS participant.'),
    ('FR', 'EU Emissions Trading System (EU ETS)', 'ets', 'confirmed', 'Full EU ETS participant.'),
    ('GR', 'EU Emissions Trading System (EU ETS)', 'ets', 'confirmed', 'Full EU ETS participant.'),
    ('HR', 'EU Emissions Trading System (EU ETS)', 'ets', 'confirmed', 'Full EU ETS participant.'),
    ('HU', 'EU Emissions Trading System (EU ETS)', 'ets', 'confirmed', 'Full EU ETS participant.'),
    ('IE', 'EU Emissions Trading System (EU ETS)', 'ets', 'confirmed', 'Full EU ETS participant.'),
    ('IT', 'EU Emissions Trading System (EU ETS)', 'ets', 'confirmed', 'Full EU ETS participant.'),
    ('LT', 'EU Emissions Trading System (EU ETS)', 'ets', 'confirmed', 'Full EU ETS participant.'),
    ('LU', 'EU Emissions Trading System (EU ETS)', 'ets', 'confirmed', 'Full EU ETS participant.'),
    ('LV', 'EU Emissions Trading System (EU ETS)', 'ets', 'confirmed', 'Full EU ETS participant.'),
    ('MT', 'EU Emissions Trading System (EU ETS)', 'ets', 'confirmed', 'Full EU ETS participant.'),
    ('NL', 'EU Emissions Trading System (EU ETS)', 'ets', 'confirmed', 'Full EU ETS participant.'),
    ('PL', 'EU Emissions Trading System (EU ETS)', 'ets', 'confirmed', 'Full EU ETS participant.'),
    ('PT', 'EU Emissions Trading System (EU ETS)', 'ets', 'confirmed', 'Full EU ETS participant.'),
    ('RO', 'EU Emissions Trading System (EU ETS)', 'ets', 'confirmed', 'Full EU ETS participant.'),
    ('SE', 'EU Emissions Trading System (EU ETS)', 'ets', 'confirmed', 'Full EU ETS participant. Also operates a national carbon tax.'),
    ('SI', 'EU Emissions Trading System (EU ETS)', 'ets', 'confirmed', 'Full EU ETS participant.'),
    ('SK', 'EU Emissions Trading System (EU ETS)', 'ets', 'confirmed', 'Full EU ETS participant.'),
    -- EEA Non-EU States — participate in EU ETS under EEA Agreement Annex XX
    ('NO', 'EU Emissions Trading System (EU ETS)', 'ets', 'confirmed', 'EEA participant in EU ETS under EEA Agreement Annex XX. Carbon price denominated in EUR.'),
    ('IS', 'EU Emissions Trading System (EU ETS)', 'ets', 'confirmed', 'EEA participant in EU ETS under EEA Agreement Annex XX. Carbon price denominated in EUR.'),
    ('LI', 'EU Emissions Trading System (EU ETS)', 'ets', 'confirmed', 'EEA participant in EU ETS under EEA Agreement Annex XX. Carbon price denominated in EUR.'),
    -- Switzerland — linked ETS
    ('CH', 'Swiss Emissions Trading Scheme (Swiss ETS)', 'ets', 'confirmed', 'Linked to EU ETS since 2020 under CH-EU ETS Agreement. Carbon price denominated in CHF. Allowances fungible with EU EUAs.'),
    -- Sweden also has a national carbon tax (applies to sectors outside EU ETS)
    ('SE', 'Swedish Carbon Tax', 'carbon_tax', 'confirmed', 'Applies to sectors not covered by EU ETS. Rate set annually by Swedish government (SEK/tCO2). Use alongside EU ETS entry for ETS-covered installations.')
ON CONFLICT (country_code, scheme_name) DO NOTHING;


-- ===========================================================================
-- 2. cbam_exchange_rates — HMRC reference rates
-- ===========================================================================

CREATE TABLE IF NOT EXISTS cbam.cbam_exchange_rates (
    id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    from_currency   CHAR(3) NOT NULL,
    to_currency     CHAR(3) NOT NULL DEFAULT 'GBP',
    rate            DECIMAL(12, 6) NOT NULL CHECK (rate > 0),
    effective_date  DATE    NOT NULL,
    source          VARCHAR(100) NOT NULL DEFAULT 'HMRC',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (from_currency, to_currency, effective_date, source)
);

CREATE INDEX IF NOT EXISTS idx_exchange_rates_lookup
    ON cbam.cbam_exchange_rates (from_currency, to_currency, effective_date DESC);

COMMENT ON TABLE cbam.cbam_exchange_rates IS
    'HMRC published monthly exchange rates for converting third-country carbon '
    'prices to GBP in CPR calculations. '
    'IMPORTANT: rates must be updated monthly from the HMRC Customs Declarants '
    'Reference Manual (CDRM) period rate table before production use. '
    'Importers may override with the rate prevailing on the import date.';

-- ---------------------------------------------------------------------------
-- 2a. Seed exchange rates — representative Q1 2026 placeholder rates
-- ---------------------------------------------------------------------------
-- IMPORTANT: These are indicative rates for testing/development only.
-- Replace with official HMRC CDRM monthly rates before production use.
-- HMRC CDRM rate table: https://www.gov.uk/government/publications/
--   customs-declarants-reference-manual-cdrm/exchange-rates-for-customs-purposes
-- ---------------------------------------------------------------------------

INSERT INTO cbam.cbam_exchange_rates
    (from_currency, to_currency, rate, effective_date, source)
VALUES
    -- EUR → GBP (primary rate — EU ETS allowances priced in EUR)
    ('EUR', 'GBP', 0.835000, '2026-01-01', 'HMRC_CDRM_PLACEHOLDER'),
    ('EUR', 'GBP', 0.836000, '2026-02-01', 'HMRC_CDRM_PLACEHOLDER'),
    ('EUR', 'GBP', 0.834000, '2026-03-01', 'HMRC_CDRM_PLACEHOLDER'),
    -- CHF → GBP (Swiss ETS allowances priced in CHF)
    ('CHF', 'GBP', 0.882000, '2026-01-01', 'HMRC_CDRM_PLACEHOLDER'),
    ('CHF', 'GBP', 0.884000, '2026-02-01', 'HMRC_CDRM_PLACEHOLDER'),
    ('CHF', 'GBP', 0.881000, '2026-03-01', 'HMRC_CDRM_PLACEHOLDER'),
    -- NOK → GBP (Norway — some installations price in NOK)
    ('NOK', 'GBP', 0.072500, '2026-01-01', 'HMRC_CDRM_PLACEHOLDER'),
    ('NOK', 'GBP', 0.073100, '2026-02-01', 'HMRC_CDRM_PLACEHOLDER'),
    ('NOK', 'GBP', 0.072800, '2026-03-01', 'HMRC_CDRM_PLACEHOLDER'),
    -- SEK → GBP (Sweden — Swedish Carbon Tax)
    ('SEK', 'GBP', 0.072000, '2026-01-01', 'HMRC_CDRM_PLACEHOLDER'),
    ('SEK', 'GBP', 0.072500, '2026-02-01', 'HMRC_CDRM_PLACEHOLDER'),
    ('SEK', 'GBP', 0.071800, '2026-03-01', 'HMRC_CDRM_PLACEHOLDER'),
    -- ISK → GBP (Iceland)
    ('ISK', 'GBP', 0.005500, '2026-01-01', 'HMRC_CDRM_PLACEHOLDER'),
    -- GBP → GBP identity (for completeness — no conversion required)
    ('GBP', 'GBP', 1.000000, '2026-01-01', 'IDENTITY')
ON CONFLICT (from_currency, to_currency, effective_date, source) DO NOTHING;


-- ===========================================================================
-- 3. cbam_cpr_claims — per-goods-line CPR calculation records
-- ===========================================================================

CREATE TABLE IF NOT EXISTS cbam.cbam_cpr_claims (
    id                          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    goods_line_id               UUID         NOT NULL
                                    REFERENCES cbam.cbam_goods_lines(id)
                                    ON DELETE CASCADE,
    tenant_id                   UUID         NOT NULL,

    -- Origin and scheme
    origin_country_code         CHAR(2)      NOT NULL,
    qualifying_scheme_name      VARCHAR(200) NOT NULL,

    -- Raw carbon price inputs (local currency, per tonne CO2e)
    carbon_price_local_currency DECIMAL(10, 4) NOT NULL CHECK (carbon_price_local_currency >= 0),
    local_currency_code         CHAR(3)        NOT NULL,
    free_allocations_received   DECIMAL(10, 4) NOT NULL DEFAULT 0
                                    CHECK (free_allocations_received >= 0),
    rebates_received            DECIMAL(10, 4) NOT NULL DEFAULT 0
                                    CHECK (rebates_received >= 0),

    -- Derived (stored for audit — can be independently re-derived from inputs)
    net_price_local_currency    DECIMAL(10, 4) NOT NULL,  -- carbon_price - allocs - rebates (≥ 0)

    -- Verified emissions (must be verified by GACI-accredited body)
    verified_emissions_tco2e    DECIMAL(15, 6) NOT NULL CHECK (verified_emissions_tco2e > 0),

    -- GBP conversion
    exchange_rate_to_gbp        DECIMAL(10, 6) NOT NULL CHECK (exchange_rate_to_gbp > 0),
    exchange_rate_date          DATE           NOT NULL,
    effective_carbon_price_gbp  DECIMAL(10, 4) NOT NULL,  -- net_price × exchange_rate

    -- CPR amounts
    cpr_raw_gbp                 DECIMAL(15, 2) NOT NULL,  -- before cap
    cpr_capped                  BOOLEAN        NOT NULL DEFAULT FALSE,
    cpr_amount_gbp              DECIMAL(15, 2) NOT NULL,  -- after cap (final)
    cbam_liability_gbp          DECIMAL(15, 2) NOT NULL,  -- cap reference (CBAM liability for goods line)

    -- Verifier (ISO 17029 / ISO 14064-3 / ISO 14065 / ISO 14066 accredited)
    verifier_name               VARCHAR(200),
    verifier_accreditation_body VARCHAR(200),
    verification_document_path  VARCHAR(500),
    verification_document_hash  CHAR(64),  -- SHA-256 hex of the verification PDF

    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for the most common query pattern: claims by goods line within a tenant
CREATE INDEX IF NOT EXISTS idx_cpr_claims_goods_line
    ON cbam.cbam_cpr_claims (goods_line_id, tenant_id, created_at DESC);

-- Index for tenant-level CPR reporting (e.g. total CPR for a return period)
CREATE INDEX IF NOT EXISTS idx_cpr_claims_tenant
    ON cbam.cbam_cpr_claims (tenant_id, created_at DESC);


-- ---------------------------------------------------------------------------
-- Column documentation
-- ---------------------------------------------------------------------------

COMMENT ON TABLE cbam.cbam_cpr_claims IS
    'UK CBAM Carbon Price Relief (CPR) claim records, one row per qualifying '
    'scheme per goods line. CPR = verified_emissions_tco2e × effective_carbon_price_gbp, '
    'capped at CBAM liability for the goods line. '
    'Regulation: Finance No.2 Bill 2025-26; HMRC Secondary Legislation Feb 2026.';

COMMENT ON COLUMN cbam.cbam_cpr_claims.net_price_local_currency IS
    'Effective carbon price per tCO2e in local currency after deducting free '
    'allocations and rebates: carbon_price_local - free_allocations - rebates. '
    'Stored (not just derived) so the audit trail is self-contained.';

COMMENT ON COLUMN cbam.cbam_cpr_claims.verified_emissions_tco2e IS
    'Embedded emissions (tCO2e) verified by a GACI-accredited independent verifier '
    'meeting ISO 17029, ISO 14064-3, ISO 14065 and ISO 14066. '
    'CPR cannot be claimed without verified emissions data.';

COMMENT ON COLUMN cbam.cbam_cpr_claims.cpr_capped IS
    'TRUE when cpr_raw_gbp would have exceeded cbam_liability_gbp. '
    'CPR cannot reduce CBAM liability below zero.';

COMMENT ON COLUMN cbam.cbam_cpr_claims.verification_document_hash IS
    'SHA-256 hex digest of the verification PDF uploaded by the accredited verifier. '
    'Used to detect tampering — cross-check against Supabase Storage before submission.';
