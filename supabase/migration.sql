-- =============================================================================
-- NUCLEOS CBAM PLATFORM — SUPABASE MIGRATION
-- Consolidated from migrations 001–007
-- Compatible with Supabase (PostgreSQL 15+)
-- RLS: retains app.current_tenant_id pattern; JWT sub claim = tenant_id
-- =============================================================================

-- ---------------------------------------------------------------------------
-- EXTENSIONS
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------------
-- SCHEMAS
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS cbam;

-- ---------------------------------------------------------------------------
-- HELPER: updated_at trigger function
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- HELPER: resolve tenant from request context
-- Priority: app.current_tenant_id session var → auth.jwt() sub claim
-- This lets both the legacy FastAPI middleware path and future Supabase
-- Auth path work transparently.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS TEXT LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_tenant TEXT;
BEGIN
  -- 1. Prefer explicitly set session variable (set by FastAPI middleware)
  v_tenant := current_setting('app.current_tenant_id', true);
  IF v_tenant IS NOT NULL AND v_tenant <> '' THEN
    RETURN v_tenant;
  END IF;

  -- 2. Fall back to Supabase JWT sub claim (future native auth path)
  BEGIN
    v_tenant := (auth.jwt() ->> 'sub');
  EXCEPTION WHEN OTHERS THEN
    v_tenant := NULL;
  END;

  RETURN v_tenant;
END;
$$;

-- =============================================================================
-- TABLE: cbam.cbam_cases
-- Quarter-level CBAM declaration container (EU 2023/956 Art. 5)
-- =============================================================================
CREATE TABLE IF NOT EXISTS cbam.cbam_cases (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id               TEXT NOT NULL,
  importer_name           TEXT,
  importer_eori           TEXT NOT NULL,
  reporting_year          INTEGER NOT NULL,
  reporting_quarter       INTEGER NOT NULL CHECK (reporting_quarter BETWEEN 1 AND 4),
  status                  TEXT NOT NULL DEFAULT 'draft'
                            CHECK (status IN ('draft','submitted','processing','approved','rejected')),
  review_status           TEXT
                            CHECK (review_status IN ('pending_review','approved','rejected','signed_off','flagged')),

  -- Art. 9 carbon price deductions
  carbon_price_paid_eur   NUMERIC(18,4),
  carbon_pricing_scheme   TEXT,

  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT cbam_cases_unique_period
    UNIQUE (tenant_id, importer_eori, reporting_year, reporting_quarter)
);

CREATE TRIGGER trg_cbam_cases_updated_at
  BEFORE UPDATE ON cbam.cbam_cases
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_cbam_cases_tenant        ON cbam.cbam_cases (tenant_id);
CREATE INDEX IF NOT EXISTS idx_cbam_cases_eori          ON cbam.cbam_cases (importer_eori);
CREATE INDEX IF NOT EXISTS idx_cbam_cases_period        ON cbam.cbam_cases (reporting_year, reporting_quarter);
CREATE INDEX IF NOT EXISTS idx_cbam_cases_status        ON cbam.cbam_cases (status);
CREATE INDEX IF NOT EXISTS idx_cbam_cases_review_status ON cbam.cbam_cases (review_status) WHERE review_status IS NOT NULL;

-- RLS
ALTER TABLE cbam.cbam_cases ENABLE ROW LEVEL SECURITY;

CREATE POLICY cbam_cases_tenant_select ON cbam.cbam_cases
  FOR SELECT USING (
    tenant_id = public.current_tenant_id()
    OR public.current_tenant_id() IS NULL   -- superuser / migration path
  );

CREATE POLICY cbam_cases_tenant_insert ON cbam.cbam_cases
  FOR INSERT WITH CHECK (
    tenant_id = public.current_tenant_id()
    OR public.current_tenant_id() IS NULL
  );

CREATE POLICY cbam_cases_tenant_update ON cbam.cbam_cases
  FOR UPDATE USING (
    tenant_id = public.current_tenant_id()
    OR public.current_tenant_id() IS NULL
  );

CREATE POLICY cbam_cases_tenant_delete ON cbam.cbam_cases
  FOR DELETE USING (
    tenant_id = public.current_tenant_id()
    OR public.current_tenant_id() IS NULL
  );

-- =============================================================================
-- TABLE: cbam.cbam_shipments
-- Invoice-level import records
-- =============================================================================
CREATE TABLE IF NOT EXISTS cbam.cbam_shipments (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  case_id          UUID NOT NULL REFERENCES cbam.cbam_cases(id) ON DELETE CASCADE,
  tenant_id        TEXT NOT NULL,
  import_date      DATE,
  entry_reference  TEXT,
  incoterm         TEXT,
  origin_country   TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_cbam_shipments_updated_at
  BEFORE UPDATE ON cbam.cbam_shipments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_cbam_shipments_case_id  ON cbam.cbam_shipments (case_id);
CREATE INDEX IF NOT EXISTS idx_cbam_shipments_tenant   ON cbam.cbam_shipments (tenant_id);

ALTER TABLE cbam.cbam_shipments ENABLE ROW LEVEL SECURITY;

CREATE POLICY cbam_shipments_tenant_select ON cbam.cbam_shipments
  FOR SELECT USING (tenant_id = public.current_tenant_id() OR public.current_tenant_id() IS NULL);

CREATE POLICY cbam_shipments_tenant_insert ON cbam.cbam_shipments
  FOR INSERT WITH CHECK (tenant_id = public.current_tenant_id() OR public.current_tenant_id() IS NULL);

CREATE POLICY cbam_shipments_tenant_update ON cbam.cbam_shipments
  FOR UPDATE USING (tenant_id = public.current_tenant_id() OR public.current_tenant_id() IS NULL);

CREATE POLICY cbam_shipments_tenant_delete ON cbam.cbam_shipments
  FOR DELETE USING (tenant_id = public.current_tenant_id() OR public.current_tenant_id() IS NULL);

-- =============================================================================
-- TABLE: cbam.cbam_goods_lines
-- Product line items within a shipment
-- =============================================================================
CREATE TABLE IF NOT EXISTS cbam.cbam_goods_lines (
  id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  shipment_id                 UUID NOT NULL REFERENCES cbam.cbam_shipments(id) ON DELETE CASCADE,
  tenant_id                   TEXT NOT NULL,
  cn_code                     TEXT NOT NULL,
  sector                      TEXT NOT NULL
                                CHECK (sector IN ('cement','iron_steel','aluminium','fertilisers','electricity','hydrogen')),
  quantity                    NUMERIC(18,6),
  unit                        TEXT,
  installation_name           TEXT,
  installation_id             TEXT,

  -- CN classification metadata (migration 005)
  cn_classification_confidence  NUMERIC(5,2) CHECK (cn_classification_confidence BETWEEN 0 AND 1),
  cn_classification_method      TEXT
                                  CHECK (cn_classification_method IN
                                    ('keyword','llm','combined','extracted_from_text','hint','manual')),
  cn_requires_review            BOOLEAN NOT NULL DEFAULT FALSE,

  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_cbam_goods_lines_updated_at
  BEFORE UPDATE ON cbam.cbam_goods_lines
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_cbam_goods_lines_shipment  ON cbam.cbam_goods_lines (shipment_id);
CREATE INDEX IF NOT EXISTS idx_cbam_goods_lines_tenant    ON cbam.cbam_goods_lines (tenant_id);
CREATE INDEX IF NOT EXISTS idx_cbam_goods_lines_cn_code   ON cbam.cbam_goods_lines (cn_code);
CREATE INDEX IF NOT EXISTS idx_cbam_goods_lines_review
  ON cbam.cbam_goods_lines (cn_requires_review) WHERE cn_requires_review = TRUE;

ALTER TABLE cbam.cbam_goods_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY cbam_goods_lines_tenant_select ON cbam.cbam_goods_lines
  FOR SELECT USING (tenant_id = public.current_tenant_id() OR public.current_tenant_id() IS NULL);

CREATE POLICY cbam_goods_lines_tenant_insert ON cbam.cbam_goods_lines
  FOR INSERT WITH CHECK (tenant_id = public.current_tenant_id() OR public.current_tenant_id() IS NULL);

CREATE POLICY cbam_goods_lines_tenant_update ON cbam.cbam_goods_lines
  FOR UPDATE USING (tenant_id = public.current_tenant_id() OR public.current_tenant_id() IS NULL);

CREATE POLICY cbam_goods_lines_tenant_delete ON cbam.cbam_goods_lines
  FOR DELETE USING (tenant_id = public.current_tenant_id() OR public.current_tenant_id() IS NULL);

-- =============================================================================
-- TABLE: cbam.cbam_emissions
-- Calculated SEE values per goods line (EU 2023/1773 Art. 4)
-- =============================================================================
CREATE TABLE IF NOT EXISTS cbam.cbam_emissions (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  goods_line_id         UUID NOT NULL REFERENCES cbam.cbam_goods_lines(id) ON DELETE CASCADE,
  tenant_id             TEXT NOT NULL,
  method                TEXT NOT NULL CHECK (method IN ('actual','default','estimated')),
  direct_kgco2e         NUMERIC(18,6),
  indirect_kgco2e       NUMERIC(18,6),
  data_quality_score    NUMERIC(5,2),
  notes                 TEXT,
  version               INTEGER NOT NULL DEFAULT 1,
  factor_table_version  TEXT NOT NULL DEFAULT '2023',   -- Annex VI version ref
  production_route      TEXT,                            -- e.g. 'BF-BOF', 'EAF'
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT cbam_emissions_unique_version UNIQUE (goods_line_id, version)
);

CREATE INDEX IF NOT EXISTS idx_cbam_emissions_goods_line ON cbam.cbam_emissions (goods_line_id);
CREATE INDEX IF NOT EXISTS idx_cbam_emissions_tenant     ON cbam.cbam_emissions (tenant_id);

ALTER TABLE cbam.cbam_emissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY cbam_emissions_tenant_select ON cbam.cbam_emissions
  FOR SELECT USING (tenant_id = public.current_tenant_id() OR public.current_tenant_id() IS NULL);

CREATE POLICY cbam_emissions_tenant_insert ON cbam.cbam_emissions
  FOR INSERT WITH CHECK (tenant_id = public.current_tenant_id() OR public.current_tenant_id() IS NULL);

CREATE POLICY cbam_emissions_tenant_update ON cbam.cbam_emissions
  FOR UPDATE USING (tenant_id = public.current_tenant_id() OR public.current_tenant_id() IS NULL);

CREATE POLICY cbam_emissions_tenant_delete ON cbam.cbam_emissions
  FOR DELETE USING (tenant_id = public.current_tenant_id() OR public.current_tenant_id() IS NULL);

-- =============================================================================
-- TABLE: cbam.cbam_snapshots
-- Append-only HMAC audit chain for calculation pipeline stages
-- =============================================================================
CREATE TABLE IF NOT EXISTS cbam.cbam_snapshots (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  case_id         UUID NOT NULL REFERENCES cbam.cbam_cases(id) ON DELETE CASCADE,
  tenant_id       TEXT NOT NULL,
  stage           TEXT NOT NULL,        -- e.g. 'extraction_v1', 'repaired_v1'
  payload_json    JSONB NOT NULL,
  payload_hash    TEXT NOT NULL,
  parent_hash     TEXT,
  algo_versions   TEXT,
  model_versions  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cbam_snapshots_case_stage
  ON cbam.cbam_snapshots (case_id, stage, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cbam_snapshots_tenant
  ON cbam.cbam_snapshots (tenant_id);

-- Snapshots are write-once; no UPDATE/DELETE for tenants
ALTER TABLE cbam.cbam_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY cbam_snapshots_tenant_select ON cbam.cbam_snapshots
  FOR SELECT USING (tenant_id = public.current_tenant_id() OR public.current_tenant_id() IS NULL);

CREATE POLICY cbam_snapshots_tenant_insert ON cbam.cbam_snapshots
  FOR INSERT WITH CHECK (tenant_id = public.current_tenant_id() OR public.current_tenant_id() IS NULL);

-- No UPDATE / DELETE policies → append-only enforced at RLS level

-- =============================================================================
-- TABLE: cbam.audit_log
-- Platform-wide signed audit events (EU 2023/956 Art. 14 record-keeping)
-- =============================================================================
CREATE TABLE IF NOT EXISTS cbam.audit_log (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    TEXT NOT NULL,
  case_id      UUID REFERENCES cbam.cbam_cases(id) ON DELETE SET NULL,
  event_type   TEXT NOT NULL,
  actor        TEXT,
  payload      JSONB,
  signature    TEXT,          -- HMAC-SHA256 of (id || event_type || payload)
  chain_hash   TEXT,          -- hash of previous audit_log row for this case
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_tenant   ON cbam.audit_log (tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_case_id  ON cbam.audit_log (case_id, created_at DESC);

ALTER TABLE cbam.audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_log_tenant_select ON cbam.audit_log
  FOR SELECT USING (tenant_id = public.current_tenant_id() OR public.current_tenant_id() IS NULL);

CREATE POLICY audit_log_tenant_insert ON cbam.audit_log
  FOR INSERT WITH CHECK (tenant_id = public.current_tenant_id() OR public.current_tenant_id() IS NULL);

-- No UPDATE / DELETE → tamper-evident

-- =============================================================================
-- TABLE: cbam.documents
-- Evidence files linked to cases (S3 / Supabase Storage references)
-- =============================================================================
CREATE TABLE IF NOT EXISTS cbam.documents (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    TEXT NOT NULL,
  case_id      UUID REFERENCES cbam.cbam_cases(id) ON DELETE CASCADE,
  filename     TEXT NOT NULL,
  content_type TEXT,
  storage_key  TEXT NOT NULL,    -- S3 key or Supabase Storage path
  size_bytes   BIGINT,
  uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_documents_tenant  ON cbam.documents (tenant_id);
CREATE INDEX IF NOT EXISTS idx_documents_case_id ON cbam.documents (case_id);

ALTER TABLE cbam.documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY documents_tenant_select ON cbam.documents
  FOR SELECT USING (tenant_id = public.current_tenant_id() OR public.current_tenant_id() IS NULL);

CREATE POLICY documents_tenant_insert ON cbam.documents
  FOR INSERT WITH CHECK (tenant_id = public.current_tenant_id() OR public.current_tenant_id() IS NULL);

CREATE POLICY documents_tenant_delete ON cbam.documents
  FOR DELETE USING (tenant_id = public.current_tenant_id() OR public.current_tenant_id() IS NULL);

-- =============================================================================
-- TABLE: cbam.cbam_users
-- Persistent user profiles mapped from JWT sub claim (EU 2023/956 Art. 5)
-- =============================================================================
CREATE TABLE IF NOT EXISTS cbam.cbam_users (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sub            TEXT NOT NULL,         -- JWT sub claim
  tenant_id      TEXT NOT NULL,
  email          TEXT,
  display_name   TEXT,
  role           TEXT NOT NULL DEFAULT 'importer'
                   CHECK (role IN ('importer','reviewer','admin','read_only')),
  last_seen_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT cbam_users_unique_sub_tenant UNIQUE (sub, tenant_id)
);

CREATE TRIGGER trg_cbam_users_updated_at
  BEFORE UPDATE ON cbam.cbam_users
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_cbam_users_tenant ON cbam.cbam_users (tenant_id);
CREATE INDEX IF NOT EXISTS idx_cbam_users_sub    ON cbam.cbam_users (sub);

ALTER TABLE cbam.cbam_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY cbam_users_tenant_select ON cbam.cbam_users
  FOR SELECT USING (tenant_id = public.current_tenant_id() OR public.current_tenant_id() IS NULL);

CREATE POLICY cbam_users_tenant_insert ON cbam.cbam_users
  FOR INSERT WITH CHECK (tenant_id = public.current_tenant_id() OR public.current_tenant_id() IS NULL);

CREATE POLICY cbam_users_tenant_update ON cbam.cbam_users
  FOR UPDATE USING (tenant_id = public.current_tenant_id() OR public.current_tenant_id() IS NULL);

-- =============================================================================
-- TABLE: cbam.cbam_emission_factors
-- Versioned Annex VI default SEE values (EU 2023/1773 Art. 4(3) + Annex VI)
-- NOT tenant-scoped — shared reference data, no RLS needed
-- =============================================================================
CREATE TABLE IF NOT EXISTS cbam.cbam_emission_factors (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cn8_prefix          TEXT NOT NULL,        -- CN8 code or 4/6-digit prefix
  sector              TEXT NOT NULL
                        CHECK (sector IN ('cement','iron_steel','aluminium','fertilisers','electricity','hydrogen')),
  production_route    TEXT,                 -- e.g. 'BF-BOF', 'EAF', 'default'
  direct_tco2e        NUMERIC(12,6) NOT NULL,   -- tCO2e per tonne of goods
  indirect_tco2e      NUMERIC(12,6) NOT NULL,
  table_version       TEXT NOT NULL DEFAULT '2023',
  effective_from      DATE NOT NULL DEFAULT '2024-01-01',
  effective_to        DATE,
  source_ref          TEXT,                 -- e.g. 'EU 2023/1773 Annex VI Table A'
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cbam_ef_cn8       ON cbam.cbam_emission_factors (cn8_prefix);
CREATE INDEX IF NOT EXISTS idx_cbam_ef_sector     ON cbam.cbam_emission_factors (sector);
CREATE INDEX IF NOT EXISTS idx_cbam_ef_version    ON cbam.cbam_emission_factors (table_version, effective_from);

-- =============================================================================
-- TABLE: cbam.cbam_electricity_factors
-- Country grid emission intensities (EU 2023/1773 Annex VI Table D)
-- NOT tenant-scoped — shared reference data
-- =============================================================================
CREATE TABLE IF NOT EXISTS cbam.cbam_electricity_factors (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  country_iso2     TEXT NOT NULL,         -- ISO 3166-1 alpha-2
  tco2e_per_mwh    NUMERIC(10,6) NOT NULL,
  table_version    TEXT NOT NULL DEFAULT '2023',
  effective_from   DATE NOT NULL DEFAULT '2024-01-01',
  effective_to     DATE,
  source_ref       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT cbam_electricity_factors_unique
    UNIQUE (country_iso2, table_version, effective_from)
);

CREATE INDEX IF NOT EXISTS idx_cbam_elec_country ON cbam.cbam_electricity_factors (country_iso2);

-- =============================================================================
-- TABLE: cbam.supplier_see_history
-- Rolling supplier-level SEE per CN code per reporting period
-- Used for B2 cross-invoice consistency (migration 006)
-- =============================================================================
CREATE TABLE IF NOT EXISTS cbam.supplier_see_history (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         TEXT NOT NULL,
  importer_eori     TEXT NOT NULL,
  supplier_name     TEXT NOT NULL,
  cn_code           TEXT NOT NULL,
  reporting_period  TEXT NOT NULL,    -- 'YYYY-QN' e.g. '2025-Q1'
  direct_tco2e      NUMERIC(18,6),
  indirect_tco2e    NUMERIC(18,6),
  source_method     TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT supplier_see_history_unique
    UNIQUE (tenant_id, importer_eori, supplier_name, cn_code, reporting_period)
);

CREATE TRIGGER trg_supplier_see_updated_at
  BEFORE UPDATE ON cbam.supplier_see_history
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_ssh_tenant          ON cbam.supplier_see_history (tenant_id);
CREATE INDEX IF NOT EXISTS idx_ssh_cn_code         ON cbam.supplier_see_history (cn_code);
CREATE INDEX IF NOT EXISTS idx_ssh_reporting_period ON cbam.supplier_see_history (reporting_period);

ALTER TABLE cbam.supplier_see_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY ssh_tenant_select ON cbam.supplier_see_history
  FOR SELECT USING (tenant_id = public.current_tenant_id() OR public.current_tenant_id() IS NULL);

CREATE POLICY ssh_tenant_insert ON cbam.supplier_see_history
  FOR INSERT WITH CHECK (tenant_id = public.current_tenant_id() OR public.current_tenant_id() IS NULL);

CREATE POLICY ssh_tenant_update ON cbam.supplier_see_history
  FOR UPDATE USING (tenant_id = public.current_tenant_id() OR public.current_tenant_id() IS NULL);

-- =============================================================================
-- TABLE: cbam.quarterly_reconciliation
-- Aggregated quarterly compliance snapshots (migration 006)
-- =============================================================================
CREATE TABLE IF NOT EXISTS cbam.quarterly_reconciliation (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id               TEXT NOT NULL,
  case_id                 UUID NOT NULL REFERENCES cbam.cbam_cases(id) ON DELETE CASCADE,
  reporting_period        TEXT NOT NULL,
  case_count              INTEGER,
  shipment_count          INTEGER,
  goods_line_count        INTEGER,
  total_net_mass_t        NUMERIC(18,6),
  total_direct_tco2e      NUMERIC(18,6),
  total_indirect_tco2e    NUMERIC(18,6),
  total_embedded_tco2e    NUMERIC(18,6),
  art9_deductions_eur     NUMERIC(18,4),
  net_cbam_liability_tco2e NUMERIC(18,6),
  certificate_requirement NUMERIC(18,6),
  financial_exposure_eur  NUMERIC(18,4),
  supplier_see_flags      JSONB,
  carbon_price_flags      JSONB,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_qr_tenant         ON cbam.quarterly_reconciliation (tenant_id);
CREATE INDEX IF NOT EXISTS idx_qr_case_id        ON cbam.quarterly_reconciliation (case_id);
CREATE INDEX IF NOT EXISTS idx_qr_period         ON cbam.quarterly_reconciliation (reporting_period);

ALTER TABLE cbam.quarterly_reconciliation ENABLE ROW LEVEL SECURITY;

CREATE POLICY qr_tenant_select ON cbam.quarterly_reconciliation
  FOR SELECT USING (tenant_id = public.current_tenant_id() OR public.current_tenant_id() IS NULL);

CREATE POLICY qr_tenant_insert ON cbam.quarterly_reconciliation
  FOR INSERT WITH CHECK (tenant_id = public.current_tenant_id() OR public.current_tenant_id() IS NULL);

-- =============================================================================
-- GRANT USAGE on cbam schema to Supabase roles
-- anon  → used for unauthenticated public routes (none in this app, but required)
-- authenticated → used for JWT-authenticated requests
-- service_role  → used by FastAPI server-side with service role key (bypasses RLS)
-- =============================================================================
GRANT USAGE ON SCHEMA cbam TO anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA cbam TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA cbam TO service_role;
GRANT SELECT ON cbam.cbam_emission_factors TO anon, authenticated;
GRANT SELECT ON cbam.cbam_electricity_factors TO anon, authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA cbam
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA cbam
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO service_role;
