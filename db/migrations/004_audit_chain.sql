-- 004_audit_chain.sql
-- Cryptographic hash chain for the audit log.
--
-- Each signed row's HMAC now incorporates the hmac_sha256 of the preceding
-- signed row for the same case (prev_hmac).  This means deletion or reordering
-- of rows breaks the chain and is detectable by verify_chain().
--
-- prev_hmac is NULL for:
--   - the first signed row of a case (no predecessor)
--   - rows written before this migration (legacy rows)
--
-- Rows written after this migration include prev_hmac in their HMAC computation:
--   HMAC = SHA256(key, f"{case_id}|{event_type}|{actor_sub}|{event_json}|{prev_hmac}")
-- Legacy rows (written before this migration) used the old format without the suffix.
-- verify_event() handles both formats transparently.

ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS prev_hmac TEXT;

-- Composite index to speed up get_prev_chain_hmac() queries (ORDER BY created_at DESC LIMIT 1)
CREATE INDEX IF NOT EXISTS idx_audit_chain ON audit_log(case_id, created_at DESC);
