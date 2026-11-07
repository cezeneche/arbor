-- Supabase's Data API roles lose all access to Arbor's tables.
--
-- Arbor reaches the database only through Prisma, as the owner. Supabase used
-- to grant anon and authenticated everything on new tables in public, so with
-- RLS off every record was readable and writable over /rest/v1/ by anyone with
-- the project's anon key, around the app and its audit chain. Production was
-- fixed by hand on 31 October 2026; this brings every other environment in
-- line and is a no-op where the grants are already gone.
--
-- service_role is not touched: document storage uses it.
-- Plain Postgres (local, CI) has no Supabase roles, so the block skips there.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
  END IF;
END $$;
