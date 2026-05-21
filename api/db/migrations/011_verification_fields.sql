-- Migration 011: Third-party verification fields for cbam_goods_lines
-- ---------------------------------------------------------------------------
-- UK CBAM requires actual embedded-emissions data to be independently
-- verified by a GACI-accredited verifier operating to:
--   ISO 17029 (verification and validation bodies)
--   ISO 14064-3 (GHG verification)
--   ISO 14065 (competence of validation/verification bodies)
--   ISO 14066 (competence requirements for GHG verifiers)
--
-- Verification is required to:
--   1. Claim 'actual_verified' status (vs. 'actual_unverified') in the HMRC return.
--      Unverified actual data is still accepted but carries lower weight in
--      regulatory assessment (Finance No.2 Bill 2025-26).
--   2. Claim Carbon Price Relief (CPR) — separate verification per CPR claim
--      is stored in cbam_cpr_claims (migration 010).
--
-- Importers must retain verification reports for 6 years (UK CBAM regs).
--
-- verification_status lifecycle:
--   not_required → goods line uses default or estimated method (no verification)
--   pending      → importer has flagged this line for verification and is
--                  engaging a GACI-accredited verifier
--   submitted    → verifier has delivered a report; awaiting compliance review
--   verified     → compliance team has accepted the report; 'actual_verified'
--                  status can now be claimed in the HMRC return
--   rejected     → compliance team has rejected the report; importer must
--                  engage a new verifier or revert to default/estimated method
-- ---------------------------------------------------------------------------

ALTER TABLE cbam.cbam_goods_lines
    ADD COLUMN IF NOT EXISTS verification_status
        VARCHAR(20) NOT NULL DEFAULT 'not_required'
        CHECK (verification_status IN (
            'not_required',
            'pending',
            'submitted',
            'verified',
            'rejected'
        )),
    ADD COLUMN IF NOT EXISTS verifier_name          VARCHAR(200),
    ADD COLUMN IF NOT EXISTS verifier_accreditation VARCHAR(200),
    ADD COLUMN IF NOT EXISTS verification_report_path VARCHAR(500),
    ADD COLUMN IF NOT EXISTS verification_report_hash CHAR(64),
    ADD COLUMN IF NOT EXISTS verified_at            TIMESTAMPTZ;

-- Fast lookup: find all goods lines requiring attention within a case.
-- Used by GET /api/cbam/cases/{id}/verification-status dashboard query.
CREATE INDEX IF NOT EXISTS idx_cbam_goods_lines_verification_status
    ON cbam.cbam_goods_lines (verification_status)
    WHERE verification_status NOT IN ('not_required', 'verified');

-- ---------------------------------------------------------------------------
-- DB-level transition guard function
-- ---------------------------------------------------------------------------
-- Prevents backwards status transitions (e.g. verified → pending).
-- Called by application code before any status update.
-- Returns '' when transition is allowed, error message when blocked.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION cbam.check_verification_transition(
    p_from_status TEXT,
    p_to_status   TEXT
)
RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
    allowed_transitions JSONB := '{
        "not_required": ["pending"],
        "pending":      ["submitted", "not_required"],
        "submitted":    ["verified", "rejected"],
        "verified":     [],
        "rejected":     ["pending"]
    }'::JSONB;
BEGIN
    IF p_from_status = p_to_status THEN
        RETURN '';
    END IF;

    IF NOT (allowed_transitions->p_from_status) @> to_jsonb(p_to_status) THEN
        RETURN format(
            'invalid_verification_transition: %s → %s is not allowed. '
            'Allowed from %s: %s',
            p_from_status,
            p_to_status,
            p_from_status,
            allowed_transitions->p_from_status
        );
    END IF;

    RETURN '';
END;
$$;

-- ---------------------------------------------------------------------------
-- Column documentation
-- ---------------------------------------------------------------------------

COMMENT ON COLUMN cbam.cbam_goods_lines.verification_status IS
    'Third-party verification lifecycle for actual-method goods lines. '
    'not_required (default) — goods line uses default or estimated calculation. '
    'pending   — verifier engagement in progress. '
    'submitted — verification report delivered; pending compliance review. '
    'verified  — report accepted; actual_verified status may be claimed in HMRC return. '
    'rejected  — report rejected; must revert to default/estimated or re-engage verifier.';

COMMENT ON COLUMN cbam.cbam_goods_lines.verifier_name IS
    'Name of the GACI-accredited independent verifier organisation '
    '(ISO 17029 / ISO 14064-3 / ISO 14065 / ISO 14066).';

COMMENT ON COLUMN cbam.cbam_goods_lines.verifier_accreditation IS
    'Accreditation body and reference number for the verifier '
    '(e.g. "UKAS ref 9876", "DAkkS D-V-0123"). '
    'GACI accreditation required for UK CBAM CPR claims.';

COMMENT ON COLUMN cbam.cbam_goods_lines.verification_report_path IS
    'Supabase Storage path of the uploaded PDF verification report: '
    '{tenant_id}/verification/{goods_line_id}/report_{timestamp}.pdf. '
    'NULL until the report is uploaded via POST /cbam/goods-lines/{id}/upload-verification.';

COMMENT ON COLUMN cbam.cbam_goods_lines.verification_report_hash IS
    'SHA-256 hex digest of the uploaded verification PDF. '
    'Used for tamper detection — cross-check against Storage before submission. '
    'Importers must retain the original document for 6 years (UK CBAM regs).';

COMMENT ON COLUMN cbam.cbam_goods_lines.verified_at IS
    'Timestamp when a compliance reviewer set verification_status = verified. '
    'NULL until the report passes compliance review.';
