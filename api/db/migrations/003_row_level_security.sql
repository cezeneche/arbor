-- Migration 003: Row-Level Security (RLS) — defense-in-depth tenant isolation
--
-- Only applied when the tenant_id column is present on each table.
-- Uses current_setting('app.tenant_id', true) which the application sets via
-- "SET LOCAL app.tenant_id = :<value>" at the start of every transaction.
--
-- The BYPASSRLS privilege on the service role is intentionally NOT granted so
-- that even the application DB user is constrained to its tenant's rows.
--
-- Empty tenant_id (legacy rows / superuser operations) bypass the policy only
-- when the session variable is unset (returns NULL from current_setting).
-- This preserves backward compatibility with pre-RLS rows.

DO $$
BEGIN

    -- ── cbam.cbam_cases ──────────────────────────────────────────────────────
    IF to_regclass('cbam.cbam_cases') IS NOT NULL
       AND EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'cbam'
             AND table_name   = 'cbam_cases'
             AND column_name  = 'tenant_id'
       )
    THEN
        ALTER TABLE cbam.cbam_cases ENABLE ROW LEVEL SECURITY;

        -- SELECT / UPDATE / DELETE: row tenant_id must match session variable
        DROP POLICY IF EXISTS tenant_isolation ON cbam.cbam_cases;
        CREATE POLICY tenant_isolation ON cbam.cbam_cases
            USING (
                tenant_id = current_setting('app.tenant_id', true)
                OR current_setting('app.tenant_id', true) IS NULL
                OR current_setting('app.tenant_id', true) = ''
            );

        -- INSERT: enforce tenant_id matches session variable (prevents cross-tenant writes)
        DROP POLICY IF EXISTS tenant_isolation_insert ON cbam.cbam_cases;
        CREATE POLICY tenant_isolation_insert ON cbam.cbam_cases
            FOR INSERT
            WITH CHECK (
                tenant_id = current_setting('app.tenant_id', true)
                OR current_setting('app.tenant_id', true) IS NULL
                OR current_setting('app.tenant_id', true) = ''
            );
    END IF;

    -- ── public.cases ─────────────────────────────────────────────────────────
    IF to_regclass('public.cases') IS NOT NULL
       AND EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public'
             AND table_name   = 'cases'
             AND column_name  = 'tenant_id'
       )
    THEN
        ALTER TABLE public.cases ENABLE ROW LEVEL SECURITY;

        DROP POLICY IF EXISTS tenant_isolation ON public.cases;
        CREATE POLICY tenant_isolation ON public.cases
            USING (
                tenant_id = current_setting('app.tenant_id', true)
                OR current_setting('app.tenant_id', true) IS NULL
                OR current_setting('app.tenant_id', true) = ''
            );

        DROP POLICY IF EXISTS tenant_isolation_insert ON public.cases;
        CREATE POLICY tenant_isolation_insert ON public.cases
            FOR INSERT
            WITH CHECK (
                tenant_id = current_setting('app.tenant_id', true)
                OR current_setting('app.tenant_id', true) IS NULL
                OR current_setting('app.tenant_id', true) = ''
            );
    END IF;

    -- ── audit_log ────────────────────────────────────────────────────────────
    -- audit_log uses case_id as a join key; tenant isolation is enforced
    -- indirectly through the cases/cbam_cases policies above.  We add a
    -- lightweight policy here for direct queries to the audit_log table.
    IF to_regclass('public.audit_log') IS NOT NULL
       AND EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public'
             AND table_name   = 'audit_log'
             AND column_name  = 'tenant_id'
       )
    THEN
        ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

        DROP POLICY IF EXISTS tenant_isolation ON public.audit_log;
        CREATE POLICY tenant_isolation ON public.audit_log
            USING (
                tenant_id = current_setting('app.tenant_id', true)
                OR current_setting('app.tenant_id', true) IS NULL
                OR current_setting('app.tenant_id', true) = ''
            );
    END IF;

END;
$$;
