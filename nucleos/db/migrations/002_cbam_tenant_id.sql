-- 002_cbam_tenant_id.sql
-- Add tenant_id to cbam_cases for multi-tenant isolation.
-- Existing rows get empty string; application code sets it on all new inserts.

ALTER TABLE cbam.cbam_cases
    ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_cbam_cases_tenant ON cbam.cbam_cases(tenant_id);
