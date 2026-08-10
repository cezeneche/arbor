-- 007_audit_chain_correction.sql
--
-- Documents the audit-table divergence that migration 004 left behind, and
-- indexes the chain on the table that actually holds the data.
--
-- Two audit tables exist:
--   cbam.audit_log    signature, chain_hash, payload, actor   ← authoritative
--   public.audit_log  hmac_sha256, prev_hmac, event_json      ← 1 pre-CBAM row
--
-- 004 altered the unqualified name and so hit public.audit_log. The chain on
-- cbam.audit_log works through chain_hash; only the migration was misdirected.
-- Application code reads both column vocabularies through one adapter, so there
-- is a single verifier and a single guarantee (RISKS.md N4).
--
-- No column is added here. cbam.audit_log already has what it needs, and adding
-- a second, empty prev_hmac beside a populated chain_hash would give a future
-- reader two candidate chain columns and no way to tell which is live.

CREATE INDEX IF NOT EXISTS idx_cbam_audit_chain
  ON cbam.audit_log (case_id, created_at DESC);
