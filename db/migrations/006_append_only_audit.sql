-- 006_append_only_audit.sql
-- Makes the audit chain append-only in the database, not only in application code.
--
-- Two changes, and the second is the one that matters:
--
-- 1. cbam_cases gains a 'deleted' status so a case can be withdrawn by
--    transition instead of by DELETE. Withdrawing a case must not destroy its
--    snapshots or audit rows — those are the evidence that the case existed.
--
-- 2. The application role loses DELETE on cbam.audit_log and
--    cbam.cbam_snapshots. The application connects on a role that bypasses RLS
--    (see the GRANT block in supabase/migration.sql), so removing the DELETE
--    statements from the code is not sufficient on its own: the next developer
--    writes another one and nothing stops it. Revoking the privilege makes the
--    guarantee structural.
--
-- Deliberately NOT revoked: DELETE on cbam_cases and its cascade children.
-- Retention deletion of case data may become a legal requirement (erasure
-- requests). The audit log records that a case existed and what was done to it;
-- it is the record of the act, and it is the thing that must survive.

-- ── 1. Soft-delete status ────────────────────────────────────────────────────

ALTER TABLE cbam.cbam_cases
  DROP CONSTRAINT IF EXISTS cbam_cases_status_check;

ALTER TABLE cbam.cbam_cases
  ADD CONSTRAINT cbam_cases_status_check
  CHECK (status IN ('draft','submitted','processing','approved','rejected','error','deleted'));

-- Listings filter on status; keep that filter index-backed per tenant.
CREATE INDEX IF NOT EXISTS idx_cbam_cases_tenant_status
  ON cbam.cbam_cases (tenant_id, status);

-- ── 2. Append-only privileges ────────────────────────────────────────────────

REVOKE DELETE ON cbam.audit_log       FROM authenticated, service_role;
REVOKE DELETE ON cbam.cbam_snapshots  FROM authenticated, service_role;

-- Audit rows are never edited either — a correction is a new event.
REVOKE UPDATE ON cbam.audit_log       FROM authenticated, service_role;

-- ALTER DEFAULT PRIVILEGES in supabase/migration.sql grants DELETE on every
-- future table in the schema. Without this, a rebuild of either table silently
-- restores the privilege this migration exists to remove.
ALTER DEFAULT PRIVILEGES IN SCHEMA cbam
  REVOKE DELETE ON TABLES FROM authenticated, service_role;
