-- Whose case it is, and what a retried post adds.
--
-- 1. Case ownership. Every Arbor organisation reaches Nucleos with the same
--    service token, so tenant_id cannot tell them apart, and migration 010's
--    reuse key — (tenant_id, importer_eori_hash, reporting_year,
--    reporting_quarter) — handed one organisation's case to another declaring
--    the same EORI for the same quarter. It also ignored jurisdiction, so a UK
--    and an EU filing for one quarter shared a case. owner_ref is the Arbor
--    organisation that opened the case; the key now includes it and the
--    jurisdiction.
--
-- 2. Idempotent shipments and goods lines. A post whose row committed but whose
--    response was lost was retried as a new row, and the case gained a second
--    copy of the goods. client_ref is the caller's key for the row; a retry with
--    the same key returns the first row.

ALTER TABLE cbam.cbam_cases
    ADD COLUMN IF NOT EXISTS owner_ref TEXT;

COMMENT ON COLUMN cbam.cbam_cases.owner_ref IS
    'The Arbor organisation that owns the case. Part of the reuse key, because every organisation shares one service tenant.';

-- Existing rows are unique under the narrower key, so they are unique under
-- this one. COALESCE so rows with no owner_ref still collide with each other
-- rather than with nothing.
CREATE UNIQUE INDEX IF NOT EXISTS cbam_cases_unique_owner_period
    ON cbam.cbam_cases (
        tenant_id,
        COALESCE(owner_ref, ''),
        importer_eori_hash,
        jurisdiction,
        reporting_year,
        reporting_quarter
    )
    WHERE importer_eori_hash IS NOT NULL;

-- Replaced, not kept beside: it would still stop a second organisation (or the
-- other jurisdiction) from opening its own case for the quarter.
DROP INDEX IF EXISTS cbam.cbam_cases_unique_period_hashed;

ALTER TABLE cbam.cbam_shipments
    ADD COLUMN IF NOT EXISTS client_ref TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS cbam_shipments_unique_client_ref
    ON cbam.cbam_shipments (case_id, client_ref)
    WHERE client_ref IS NOT NULL;

ALTER TABLE cbam.cbam_goods_lines
    ADD COLUMN IF NOT EXISTS client_ref TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS cbam_goods_lines_unique_client_ref
    ON cbam.cbam_goods_lines (shipment_id, client_ref)
    WHERE client_ref IS NOT NULL;
