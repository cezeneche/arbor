-- Migration 007: Users table + Emission Factors table
-- ─────────────────────────────────────────────────────────────────────────────
-- Closes two schema gaps identified in the database audit:
--
-- 1. cbam.cbam_users
--    Persistent user master data linked to JWT sub claims.
--    JWT remains the authentication mechanism; this table extends it with
--    profile, role, and audit metadata for display, notifications, and RBAC.
--    Regulation: EU 2023/956 Art. 5 (importer obligations / authorised
--    representative) requires knowing who submits declarations.
--
-- 2. cbam.cbam_emission_factors
--    Versioned Annex VI default SEE table in the database.
--    Previously hard-coded in cbam_emission_factors.py — moving it to the DB
--    enables:
--      a) Audit trail of factor table changes (future regulation updates)
--      b) Per-calculation factor_table_version recorded on cbam_emissions
--      c) Runtime factor queries without code redeploy
--    Regulation: EU 2023/1773 Art. 4(3) + Annex VI (default SEE values)
--
-- 3. cbam_emissions.factor_table_version  (ALTER)
--    Records which Annex VI factor table version produced each emission record
--    for full calculation auditability.
--
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Users ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS cbam.cbam_users (
    -- Identity
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    sub         TEXT        NOT NULL,           -- JWT sub claim (opaque ID)
    email       TEXT,                           -- display / notification
    display_name TEXT,

    -- Tenant & role
    tenant_id   TEXT        NOT NULL DEFAULT '',
    role        TEXT        NOT NULL DEFAULT 'importer'
                CHECK (role IN ('importer', 'reviewer', 'admin', 'read_only')),

    -- Status
    is_active   BOOLEAN     NOT NULL DEFAULT TRUE,

    -- Timestamps
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ,

    -- One sub per tenant
    CONSTRAINT uq_cbam_users_sub_tenant UNIQUE (sub, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_cbam_users_tenant
    ON cbam.cbam_users (tenant_id);

CREATE INDEX IF NOT EXISTS idx_cbam_users_sub
    ON cbam.cbam_users (sub);

CREATE INDEX IF NOT EXISTS idx_cbam_users_email
    ON cbam.cbam_users (email)
    WHERE email IS NOT NULL;

-- Auto-update updated_at
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'trg_set_updated_at_cbam_users'
    ) THEN
        CREATE TRIGGER trg_set_updated_at_cbam_users
        BEFORE UPDATE ON cbam.cbam_users
        FOR EACH ROW EXECUTE FUNCTION cbam.set_updated_at();
    END IF;
END $$;

-- Row-level security: users can only see rows for their own tenant
ALTER TABLE cbam.cbam_users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON cbam.cbam_users;
CREATE POLICY tenant_isolation ON cbam.cbam_users
    USING (tenant_id = current_setting('app.current_tenant_id', TRUE));


-- ── 2. Emission Factors (Annex VI) ───────────────────────────────────────────
-- Versioned table of CBAM default SEE values sourced from EU 2023/1773 Annex VI.
-- Seeded at startup from cbam_emission_factors.py via the startup seeder
-- (ledger_app/services/cbam_factors_seeder.py).  The Python module remains the
-- source-of-truth for the current transitional period; future regulation updates
-- will be applied via new rows with an incremented table_version.

CREATE TABLE IF NOT EXISTS cbam.cbam_emission_factors (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

    -- CN code (8-digit EU Combined Nomenclature)
    cn8_prefix          TEXT        NOT NULL,
    -- CBAM sector
    sector              TEXT        NOT NULL
                        CHECK (sector IN (
                            'cement','iron_steel','aluminium',
                            'fertilisers','electricity','hydrogen'
                        )),

    -- Production route (NULL = route-agnostic world-average)
    production_route    TEXT,

    -- Default SEE values (tCO2e per tonne of goods)
    direct_tco2e_per_t  NUMERIC(12,6) NOT NULL CHECK (direct_tco2e_per_t >= 0),
    indirect_tco2e_per_t NUMERIC(12,6) NOT NULL CHECK (indirect_tco2e_per_t >= 0),

    -- Description and source reference
    description         TEXT,
    source_ref          TEXT        NOT NULL,   -- e.g. "EU 2023/1773 Annex VI Table 1"

    -- Versioning (one row per factor, per version)
    table_version       TEXT        NOT NULL DEFAULT '2023',
    -- ISO 8601 date the factor becomes effective
    effective_from      DATE        NOT NULL DEFAULT '2023-10-01',
    -- NULL = currently active; set when superseded
    effective_to        DATE,

    -- Audit
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    seeded_by           TEXT,       -- 'startup_seeder' | 'migration_NNN' | 'manual'

    -- One active factor per (cn8_prefix, production_route, table_version)
    CONSTRAINT uq_cbam_factors_cn_route_version
        UNIQUE (cn8_prefix, production_route, table_version)
);

CREATE INDEX IF NOT EXISTS idx_cbam_factors_cn
    ON cbam.cbam_emission_factors (cn8_prefix);

CREATE INDEX IF NOT EXISTS idx_cbam_factors_sector
    ON cbam.cbam_emission_factors (sector);

CREATE INDEX IF NOT EXISTS idx_cbam_factors_version
    ON cbam.cbam_emission_factors (table_version, effective_from);

-- Partial index for currently active factors (no effective_to set)
CREATE INDEX IF NOT EXISTS idx_cbam_factors_active
    ON cbam.cbam_emission_factors (cn8_prefix, production_route)
    WHERE effective_to IS NULL;

-- No RLS needed — factor table is read-only for all tenants
-- (factors are universal across importers)


-- ── 3. Electricity factors (country-specific) ─────────────────────────────────
-- Country-level electricity grid emission factors per EU 2023/1773 Annex VI D.
-- These are used for electricity-sector CBAM imports.

CREATE TABLE IF NOT EXISTS cbam.cbam_electricity_factors (
    id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    country_iso2    CHAR(2) NOT NULL,
    -- Emission factor (tCO2e per MWh)
    tco2e_per_mwh   NUMERIC(10,6) NOT NULL CHECK (tco2e_per_mwh >= 0),
    -- Source and version
    source_ref      TEXT    NOT NULL DEFAULT 'EU 2023/1773 Annex VI Table D',
    table_version   TEXT    NOT NULL DEFAULT '2023',
    effective_from  DATE    NOT NULL DEFAULT '2023-10-01',
    effective_to    DATE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_electricity_factors_country_version
        UNIQUE (country_iso2, table_version)
);

CREATE INDEX IF NOT EXISTS idx_elec_factors_country
    ON cbam.cbam_electricity_factors (country_iso2);


-- ── 4. Add factor_table_version to cbam_emissions ────────────────────────────
-- Record which Annex VI version was used to compute each emission record.
-- NULL for records created before this migration (pre-007 data).

ALTER TABLE cbam.cbam_emissions
    ADD COLUMN IF NOT EXISTS factor_table_version TEXT;

-- Backfill existing rows with '2023' (the only version before this migration)
UPDATE cbam.cbam_emissions
    SET factor_table_version = '2023'
    WHERE factor_table_version IS NULL;

-- ── 5. Add production_route to cbam_emissions ────────────────────────────────
-- Store which production route was used for the Annex VI lookup / validation.

ALTER TABLE cbam.cbam_emissions
    ADD COLUMN IF NOT EXISTS production_route TEXT;

-- ─────────────────────────────────────────────────────────────────────────────
-- Comments
-- ─────────────────────────────────────────────────────────────────────────────

COMMENT ON TABLE cbam.cbam_users IS
    'Persistent user master data linked to JWT sub claims. '
    'Extends JWT auth with profile, role, and audit metadata. '
    'EU 2023/956 Art. 5 — authorised importer / representative identity.';

COMMENT ON TABLE cbam.cbam_emission_factors IS
    'Versioned Annex VI default SEE table. '
    'Seeded from cbam_emission_factors.py at startup. '
    'Commission Implementing Regulation EU 2023/1773, Art. 4(3) + Annex VI.';

COMMENT ON TABLE cbam.cbam_electricity_factors IS
    'Country-level electricity grid emission factors. '
    'EU 2023/1773 Annex VI Table D — used for electricity-sector CBAM goods.';

COMMENT ON COLUMN cbam.cbam_emissions.factor_table_version IS
    'Annex VI table version used for this emission calculation. '
    'NULL for pre-007 records (assumed 2023 transitional period).';

COMMENT ON COLUMN cbam.cbam_emissions.production_route IS
    'Production route used for Annex VI factor lookup (e.g. BF_BOF, EAF). '
    'NULL for default/world-average calculations.';
