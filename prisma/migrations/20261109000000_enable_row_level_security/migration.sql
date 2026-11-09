-- Row-level security on every table in public.
--
-- Production had it switched on by hand on 7 November 2026, with no policies,
-- so a database rebuilt from these migrations did not match. This records it.
--
-- Arbor reaches its tables only through Prisma, as their owner, and RLS that is
-- enabled but not forced does not restrict the owner, so the app is unaffected.
-- Any other role, such as Supabase's Data API roles, sees no rows. A no-op in
-- production, where every table already has it.
--
-- scripts/ci/check-row-level-security.mjs fails CI if a later migration creates
-- a table without it.

DO $$
DECLARE
  t RECORD;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.relname);
  END LOOP;
END $$;
