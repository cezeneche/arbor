-- Migration 015: tokenised supplier emissions data form
-- ---------------------------------------------------------------------------
-- Suppliers receive a one-time signed URL (no login) and submit their facility
-- emissions data directly. On successful submission the token is consumed
-- and cannot be reused.
--
-- Regulatory basis:
--   Finance (No.2) Bill 2025-26, s.7(3) — importer must obtain SEE data
--   from the installation operator where Tier 1 actual data is available.
--   EU 2023/1773, Art. 4(1)(a) — Tier 1 actual specific embedded emissions.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS cbam.cbam_supplier_tokens (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    token          VARCHAR(64) UNIQUE NOT NULL,
    tenant_id      UUID        NOT NULL,
    case_id        UUID        NOT NULL,
    goods_line_id  UUID        NOT NULL,
    created_by     TEXT        NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at     TIMESTAMPTZ NOT NULL,
    used_at        TIMESTAMPTZ
);

COMMENT ON TABLE cbam.cbam_supplier_tokens IS
    'One-time tokens for the tokenised supplier emissions form. '
    'Each token is tied to one goods_line_id. Consumed (used_at set) '
    'on first successful form submission. Expires after 30 days.';

CREATE INDEX IF NOT EXISTS idx_cbam_supplier_tokens_token
    ON cbam.cbam_supplier_tokens (token);

CREATE INDEX IF NOT EXISTS idx_cbam_supplier_tokens_goods_line
    ON cbam.cbam_supplier_tokens (goods_line_id);
