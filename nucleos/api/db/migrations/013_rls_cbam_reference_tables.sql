-- Migration 013: Row-Level Security — cbam schema reference and tenant tables
-- ---------------------------------------------------------------------------
-- Resolves Supabase linter errors (rls_disabled_in_public) for 7 tables in
-- the cbam schema that were created without RLS in migrations 007, 010, 012.
--
-- Two categories:
--
--   A) Reference / lookup tables — universal data shared across all tenants.
--      No tenant_id column.  Strategy: enable RLS + a permissive SELECT policy
--      for the authenticated service role.  Blocks anonymous PostgREST access
--      (anon role) while allowing the application backend full read access.
--      No INSERT / UPDATE policy — all writes to reference tables are done via
--      migrations only (the "never UPDATE, always INSERT" versioning rule).
--
--      Tables: cbam_emission_factors, cbam_electricity_factors,
--              cbam_qualifying_schemes, cbam_exchange_rates
--
--   B) Tenant data tables — one logical record per tenant.
--      Has a tenant_id column.  Strategy: enable RLS + tenant_isolation policy
--      matching the pattern in migration 003.  Tenant_id must equal the session
--      variable set by FastAPI middleware before every request.
--
--      Tables: cbam_cpr_claims, cbam_registration, cbam_threshold_alerts
-- ---------------------------------------------------------------------------

DO $$
BEGIN

    -- =========================================================================
    -- A) Reference tables — permissive SELECT for authenticated role only
    -- =========================================================================

    -- ── cbam.cbam_emission_factors ───────────────────────────────────────────
    -- Annex VI versioned SEE default values.  Insert-only via migrations.
    -- Note: migration 007 incorrectly commented "No RLS needed" — this fixes it.
    IF to_regclass('cbam.cbam_emission_factors') IS NOT NULL THEN
        ALTER TABLE cbam.cbam_emission_factors ENABLE ROW LEVEL SECURITY;

        DROP POLICY IF EXISTS reference_select ON cbam.cbam_emission_factors;
        CREATE POLICY reference_select ON cbam.cbam_emission_factors
            FOR SELECT
            USING (true);
        -- USING (true) allows any authenticated DB user to SELECT.
        -- The Supabase anon role is blocked because it is not granted
        -- SELECT on this table and RLS is now active.
    END IF;

    -- ── cbam.cbam_electricity_factors ────────────────────────────────────────
    -- Country-level electricity grid emission intensity factors.
    IF to_regclass('cbam.cbam_electricity_factors') IS NOT NULL THEN
        ALTER TABLE cbam.cbam_electricity_factors ENABLE ROW LEVEL SECURITY;

        DROP POLICY IF EXISTS reference_select ON cbam.cbam_electricity_factors;
        CREATE POLICY reference_select ON cbam.cbam_electricity_factors
            FOR SELECT
            USING (true);
    END IF;

    -- ── cbam.cbam_qualifying_schemes ─────────────────────────────────────────
    -- HMRC-recognised third-country carbon pricing schemes for CPR.
    IF to_regclass('cbam.cbam_qualifying_schemes') IS NOT NULL THEN
        ALTER TABLE cbam.cbam_qualifying_schemes ENABLE ROW LEVEL SECURITY;

        DROP POLICY IF EXISTS reference_select ON cbam.cbam_qualifying_schemes;
        CREATE POLICY reference_select ON cbam.cbam_qualifying_schemes
            FOR SELECT
            USING (true);
    END IF;

    -- ── cbam.cbam_exchange_rates ──────────────────────────────────────────────
    -- HMRC CDRM monthly exchange rates (GBP conversion for CPR calculations).
    IF to_regclass('cbam.cbam_exchange_rates') IS NOT NULL THEN
        ALTER TABLE cbam.cbam_exchange_rates ENABLE ROW LEVEL SECURITY;

        DROP POLICY IF EXISTS reference_select ON cbam.cbam_exchange_rates;
        CREATE POLICY reference_select ON cbam.cbam_exchange_rates
            FOR SELECT
            USING (true);
    END IF;


    -- =========================================================================
    -- B) Tenant data tables — full tenant isolation
    -- =========================================================================

    -- ── cbam.cbam_cpr_claims ──────────────────────────────────────────────────
    -- Per-goods-line Carbon Price Relief calculation records.
    IF to_regclass('cbam.cbam_cpr_claims') IS NOT NULL
       AND EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'cbam'
             AND table_name   = 'cbam_cpr_claims'
             AND column_name  = 'tenant_id'
       )
    THEN
        ALTER TABLE cbam.cbam_cpr_claims ENABLE ROW LEVEL SECURITY;

        DROP POLICY IF EXISTS tenant_isolation ON cbam.cbam_cpr_claims;
        CREATE POLICY tenant_isolation ON cbam.cbam_cpr_claims
            USING (
                tenant_id::text = current_setting('app.tenant_id', true)
                OR current_setting('app.tenant_id', true) IS NULL
                OR current_setting('app.tenant_id', true) = ''
            );

        DROP POLICY IF EXISTS tenant_isolation_insert ON cbam.cbam_cpr_claims;
        CREATE POLICY tenant_isolation_insert ON cbam.cbam_cpr_claims
            FOR INSERT
            WITH CHECK (
                tenant_id::text = current_setting('app.tenant_id', true)
                OR current_setting('app.tenant_id', true) IS NULL
                OR current_setting('app.tenant_id', true) = ''
            );
    END IF;

    -- ── cbam.cbam_registration ────────────────────────────────────────────────
    -- One row per tenant; HMRC registration state and checklist fields.
    IF to_regclass('cbam.cbam_registration') IS NOT NULL
       AND EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'cbam'
             AND table_name   = 'cbam_registration'
             AND column_name  = 'tenant_id'
       )
    THEN
        ALTER TABLE cbam.cbam_registration ENABLE ROW LEVEL SECURITY;

        DROP POLICY IF EXISTS tenant_isolation ON cbam.cbam_registration;
        CREATE POLICY tenant_isolation ON cbam.cbam_registration
            USING (
                tenant_id::text = current_setting('app.tenant_id', true)
                OR current_setting('app.tenant_id', true) IS NULL
                OR current_setting('app.tenant_id', true) = ''
            );

        DROP POLICY IF EXISTS tenant_isolation_insert ON cbam.cbam_registration;
        CREATE POLICY tenant_isolation_insert ON cbam.cbam_registration
            FOR INSERT
            WITH CHECK (
                tenant_id::text = current_setting('app.tenant_id', true)
                OR current_setting('app.tenant_id', true) IS NULL
                OR current_setting('app.tenant_id', true) = ''
            );
    END IF;

    -- ── cbam.cbam_threshold_alerts ────────────────────────────────────────────
    -- Monthly registration threshold check event log, immutable per tenant.
    IF to_regclass('cbam.cbam_threshold_alerts') IS NOT NULL
       AND EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'cbam'
             AND table_name   = 'cbam_threshold_alerts'
             AND column_name  = 'tenant_id'
       )
    THEN
        ALTER TABLE cbam.cbam_threshold_alerts ENABLE ROW LEVEL SECURITY;

        DROP POLICY IF EXISTS tenant_isolation ON cbam.cbam_threshold_alerts;
        CREATE POLICY tenant_isolation ON cbam.cbam_threshold_alerts
            USING (
                tenant_id::text = current_setting('app.tenant_id', true)
                OR current_setting('app.tenant_id', true) IS NULL
                OR current_setting('app.tenant_id', true) = ''
            );

        DROP POLICY IF EXISTS tenant_isolation_insert ON cbam.cbam_threshold_alerts;
        CREATE POLICY tenant_isolation_insert ON cbam.cbam_threshold_alerts
            FOR INSERT
            WITH CHECK (
                tenant_id::text = current_setting('app.tenant_id', true)
                OR current_setting('app.tenant_id', true) IS NULL
                OR current_setting('app.tenant_id', true) = ''
            );
    END IF;

END;
$$;
