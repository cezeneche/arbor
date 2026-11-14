-- The read-only login the nightly backup uses to read Arbor's database
-- (ARBOR_BACKUP_DATABASE_URL), so backups never use the app's own login.
-- Same shape as Nucleos's `arbor_backup` login.
--
-- Already applied in production. Checked 14 November 2026: the role exists with
-- exactly these settings and grants, and a backup run connected as arbor_backup.
-- Kept as the record of what the login is, and to rebuild it in a new project
-- (docs/runbooks/restore-database.md, "Backup logins"): run once, as postgres,
-- in the Supabase SQL editor, with the placeholder replaced by a new random
-- password from the password manager. Never commit the real one.

CREATE ROLE arbor_backup LOGIN PASSWORD 'REPLACE_WITH_A_NEW_RANDOM_PASSWORD';

-- Every table in public has row-level security on with no policies, so any
-- login but the owner would read zero rows and back up empty tables.
-- BYPASSRLS lets it read every row; it grants nothing else.
ALTER ROLE arbor_backup BYPASSRLS;

-- Read only, twice over: it is granted SELECT and nothing else, and every
-- transaction it opens is read only.
ALTER ROLE arbor_backup SET default_transaction_read_only = on;

GRANT USAGE ON SCHEMA public TO arbor_backup;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO arbor_backup;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO arbor_backup;

-- Tables that future migrations create (migrations run as postgres).
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT ON TABLES TO arbor_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT ON SEQUENCES TO arbor_backup;

-- Check: arbor_backup | t (bypassrls) | f (not superuser) | default_transaction_read_only=on
SELECT rolname, rolbypassrls, rolsuper, rolconfig FROM pg_roles WHERE rolname = 'arbor_backup';
