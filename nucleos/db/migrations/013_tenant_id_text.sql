-- 013: every CBAM tenant_id column is TEXT.
--
-- Found in production on 6 October 2026. Opening carbon price relief failed:
--
--     invalid input syntax for type uuid: "arbor"
--     ... FROM cbam.cbam_cpr_claims WHERE goods_line_id = ... AND tenant_id = 'arbor'
--
-- The production database still had cbam_cpr_claims as the old second lineage
-- made it, with tenant_id UUID. Migration 008 meant to bring the table across
-- with tenant_id TEXT, but it says CREATE TABLE IF NOT EXISTS, and on a
-- database that already had the table that changes nothing. Arbor's tenant in
-- Nucleos is the text 'arbor', which a UUID column can neither store nor be
-- compared with, so no relief claim could be read or written. Migration 009
-- brought cbam_registration and cbam_threshold_alerts across the same way.
--
-- This converts whichever cbam tenant_id columns are not TEXT. It is one
-- block, so it applies completely or not at all, and it does nothing on a
-- database that is already right (every database built from this lineage).
--
-- A column used in a policy cannot change type, so a table's policies are
-- dropped before its column is converted and put back afterwards exactly as
-- they were. cbam_cpr_claims is the exception: it ends with the two policies
-- migration 008 defines, whatever it had.

DO $$
DECLARE
  tbl  RECORD;
  pol  RECORD;
  kept JSONB := '[]'::jsonb;
  item JSONB;
  stmt TEXT;
BEGIN
  FOR tbl IN
    SELECT c.table_name, c.data_type
    FROM   information_schema.columns c
    JOIN   information_schema.tables  t
           ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE  c.table_schema = 'cbam'
    AND    c.column_name  = 'tenant_id'
    AND    c.data_type   <> 'text'
    AND    t.table_type   = 'BASE TABLE'
    ORDER  BY c.table_name
  LOOP
    FOR pol IN
      SELECT policyname, permissive, roles, cmd, qual, with_check
      FROM   pg_policies
      WHERE  schemaname = 'cbam' AND tablename = tbl.table_name
    LOOP
      IF tbl.table_name <> 'cbam_cpr_claims' THEN
        stmt := format('CREATE POLICY %I ON cbam.%I AS %s FOR %s TO %s',
                       pol.policyname, tbl.table_name, pol.permissive, pol.cmd,
                       (SELECT string_agg(CASE WHEN r = 'public' THEN 'PUBLIC' ELSE quote_ident(r) END, ', ')
                        FROM unnest(pol.roles) AS r));
        IF pol.qual IS NOT NULL THEN
          stmt := stmt || format(' USING (%s)', pol.qual);
        END IF;
        IF pol.with_check IS NOT NULL THEN
          stmt := stmt || format(' WITH CHECK (%s)', pol.with_check);
        END IF;
        kept := kept || jsonb_build_array(stmt);
      END IF;
      EXECUTE format('DROP POLICY %I ON cbam.%I', pol.policyname, tbl.table_name);
    END LOOP;

    EXECUTE format('ALTER TABLE cbam.%I ALTER COLUMN tenant_id TYPE TEXT USING tenant_id::text',
                   tbl.table_name);
    RAISE NOTICE '013: cbam.%.tenant_id converted from % to text', tbl.table_name, tbl.data_type;
  END LOOP;

  FOR item IN SELECT * FROM jsonb_array_elements(kept)
  LOOP
    EXECUTE item #>> '{}';
  END LOOP;

  -- Relief claims: row-level security as migration 008 defines it.
  IF to_regclass('cbam.cbam_cpr_claims') IS NOT NULL THEN
    ALTER TABLE cbam.cbam_cpr_claims ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS cbam_cpr_claims_tenant_select ON cbam.cbam_cpr_claims;
    DROP POLICY IF EXISTS cbam_cpr_claims_tenant_insert ON cbam.cbam_cpr_claims;
    CREATE POLICY cbam_cpr_claims_tenant_select ON cbam.cbam_cpr_claims
      FOR SELECT USING (tenant_id = public.current_tenant_id());
    CREATE POLICY cbam_cpr_claims_tenant_insert ON cbam.cbam_cpr_claims
      FOR INSERT WITH CHECK (tenant_id = public.current_tenant_id());
  END IF;
END $$;
