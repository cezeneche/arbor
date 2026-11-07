-- 014_revoke_data_api_grants.sql
-- Supabase's Data API roles lose all access to Nucleos tables.
--
-- Nucleos connects as the owner through the pooler and never switches role;
-- no code reads a table over the Data API (/rest/v1/). anon and authenticated
-- nevertheless held privileges in public (Supabase's old default for new
-- tables) and in cbam (supabase/migration.sql granted them, and its default
-- privileges extended them to every later table). Found on 31 October 2026
-- and revoked by hand in production; this does the same everywhere else and
-- is a no-op where the grants are already gone.
--
-- The RLS policies stay. They still bind any role that is not the owner.
-- service_role is not touched: storage uses it, and 006 already narrowed it.

REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL TABLES    IN SCHEMA cbam   FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA cbam   FROM anon, authenticated;
REVOKE USAGE ON SCHEMA cbam FROM anon, authenticated;

-- Without these, the next table created in either schema gets them back.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES    FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA cbam   REVOKE ALL ON TABLES    FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA cbam   REVOKE ALL ON SEQUENCES FROM anon, authenticated;
