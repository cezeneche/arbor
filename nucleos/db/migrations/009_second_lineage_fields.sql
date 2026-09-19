-- 009: the rest of the second lineage's schema, in the base lineage.
--
-- A new Nucleos database is built from the base lineage (supabase/migration.sql
-- + db/migrations/). Beyond the CPR tables (008), the second lineage
-- (api/db/migrations/, since removed) held columns and tables the application writes to and
-- the base lineage lacked. The code detects columns at runtime, so on the base
-- lineage these were dropped silently rather than failing:
--
--   - cbam_cases.jurisdiction — the regime Arbor's handoff sends (UK/EU/BOTH)
--   - shipment consignment fields (entry reference, customs value, procedure)
--   - goods-line verification fields — without them no line can be
--     'actual_verified', and every actual figure is downgraded
--   - importer registration and threshold alerts
--
-- Brought across unchanged except tenant_id TEXT (as on every base-lineage
-- table) where the second lineage used UUID. Each statement is idempotent.

-- ---------------------------------------------------------------------------
-- From the former api/db/migrations/008_consignment_fields.sql
-- ---------------------------------------------------------------------------

-- Migration 008: consignment-level fields for UK HMRC CBAM reporting
-- ---------------------------------------------------------------------------
-- UK CBAM requires reporting at consignment level, where a consignment is
-- identified by the Entry Summary Declaration (ENS) number or customs entry
-- reference.  The existing cbam_shipments table conflated the commercial
-- "shipment" concept with the customs "consignment" concept; these four
-- columns make the distinction explicit.
-- ---------------------------------------------------------------------------

ALTER TABLE cbam.cbam_shipments
    ADD COLUMN IF NOT EXISTS consignment_reference  VARCHAR(50),
    ADD COLUMN IF NOT EXISTS customs_procedure_code VARCHAR(10),
    ADD COLUMN IF NOT EXISTS net_weight_kg          DECIMAL(15, 4),
    ADD COLUMN IF NOT EXISTS is_temporary_admission BOOLEAN NOT NULL DEFAULT FALSE;

-- Fast lookup when cross-consignment validation queries all shipments
-- sharing the same consignment_reference within a case.
CREATE INDEX IF NOT EXISTS idx_cbam_shipments_consignment_ref
    ON cbam.cbam_shipments (case_id, consignment_reference)
    WHERE consignment_reference IS NOT NULL;

-- ---------------------------------------------------------------------------
-- DB-level validation function
-- ---------------------------------------------------------------------------
-- Returns one TEXT row per conflict found, or an empty set when the case is
-- internally consistent.  Called by application code after insert/update;
-- Supabase does not support DEFERRABLE cross-row CHECK constraints so this
-- function replaces what would otherwise be a DB trigger.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION cbam.validate_consignment_consistency(p_case_id UUID)
RETURNS SETOF TEXT
LANGUAGE plpgsql STABLE
AS $$
DECLARE
    rec RECORD;
BEGIN
    FOR rec IN
        SELECT
            consignment_reference,
            COUNT(DISTINCT origin_country)                    AS distinct_countries,
            COUNT(DISTINCT import_date)                       AS distinct_dates,
            array_agg(DISTINCT origin_country ORDER BY origin_country) AS countries,
            array_agg(DISTINCT import_date    ORDER BY import_date)    AS dates
        FROM cbam.cbam_shipments
        WHERE case_id              = p_case_id
          AND consignment_reference IS NOT NULL
        GROUP BY consignment_reference
        HAVING COUNT(DISTINCT origin_country) > 1
            OR COUNT(DISTINCT import_date)    > 1
    LOOP
        IF rec.distinct_countries > 1 THEN
            RETURN NEXT format(
                'consignment_conflict:origin_country:ref=%s:countries=%s',
                rec.consignment_reference,
                array_to_string(rec.countries, ',')
            );
        END IF;
        IF rec.distinct_dates > 1 THEN
            RETURN NEXT format(
                'consignment_conflict:import_date:ref=%s:dates=%s',
                rec.consignment_reference,
                array_to_string(rec.dates::text[], ',')
            );
        END IF;
    END LOOP;
END;
$$;

-- Column documentation
COMMENT ON COLUMN cbam.cbam_shipments.consignment_reference IS
    'Customs Entry Summary Declaration (ENS) number or HMRC customs entry '
    'reference (e.g. "25GB1234567890ABC1"). Required for the UK HMRC CBAM '
    'quarterly return. NULL when not yet confirmed — flag for human '
    'completion before submission.';

COMMENT ON COLUMN cbam.cbam_shipments.customs_procedure_code IS
    'UK/EU customs procedure code (CPC) pair, e.g. "40 00" for release '
    'into free circulation or "53 00" for temporary admission. '
    'Determines CBAM applicability (temporary admission is exempt).';

COMMENT ON COLUMN cbam.cbam_shipments.net_weight_kg IS
    'Total consignment net weight in kg as declared on the customs entry. '
    'Distinct from individual goods_line weights, which should sum to this '
    'figure. Used for cross-validation against SAD Box 35.';

COMMENT ON COLUMN cbam.cbam_shipments.is_temporary_admission IS
    'TRUE when goods entered under temporary admission procedure (CPC 53 xx). '
    'Temporary admission consignments are exempt from CBAM liability and must '
    'be excluded from the quarterly HMRC return.';

-- ---------------------------------------------------------------------------
-- From the former api/db/migrations/009_jurisdiction.sql
-- ---------------------------------------------------------------------------

-- Migration 009: jurisdiction selector and EU Art. 9 carbon price deduction
-- ---------------------------------------------------------------------------
-- Two new case-level fields:
--
--   jurisdiction  — determines which regulatory output formats are produced:
--     'EU'   → EU CBAM quarterly XML only (Reg 2023/956 / IR 2023/1773)
--     'UK'   → UK HMRC return only (Finance No.2 Bill 2025-26)
--     'BOTH' → both EU XML and UK HMRC return (dual-exposure importers)
--
--   carbon_price_paid_third_country_eur  — per-tonne carbon price (EUR/tCO2e)
--     paid in the goods' country of origin under an EU-recognised scheme.
--     Maps to EU 2023/956 Article 9 deduction (certificate surrender reduction).
--     NULL when no recognised scheme applies or assessment is still pending.
--     Also used in the UK HMRC return as carbon price relief.
-- ---------------------------------------------------------------------------

ALTER TABLE cbam.cbam_cases
    ADD COLUMN IF NOT EXISTS jurisdiction                        VARCHAR(10) NOT NULL DEFAULT 'EU',
    ADD COLUMN IF NOT EXISTS carbon_price_paid_third_country_eur DECIMAL(15, 6);

-- Allowed-values guard (PostgreSQL does not support ADD CONSTRAINT IF NOT EXISTS,
-- so we wrap in a DO block to make the migration idempotent).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM   information_schema.table_constraints
        WHERE  constraint_schema = 'cbam'
          AND  table_name        = 'cbam_cases'
          AND  constraint_name   = 'chk_cbam_cases_jurisdiction'
    ) THEN
        ALTER TABLE cbam.cbam_cases
            ADD CONSTRAINT chk_cbam_cases_jurisdiction
                CHECK (jurisdiction IN ('UK', 'EU', 'BOTH'));
    END IF;
END $$;

-- Index for jurisdiction-filtered queries
-- (e.g. list all UK-only cases for HMRC submission batch)
CREATE INDEX IF NOT EXISTS idx_cbam_cases_jurisdiction
    ON cbam.cbam_cases (jurisdiction);

-- ---------------------------------------------------------------------------
-- Column documentation
-- ---------------------------------------------------------------------------

COMMENT ON COLUMN cbam.cbam_cases.jurisdiction IS
    'Regulatory output jurisdiction for this case. '
    '"EU" (default) → EU CBAM quarterly XML (Reg 2023/956 / IR 2023/1773). '
    '"UK" → UK HMRC CBAM return (Finance No.2 Bill 2025-26). '
    '"BOTH" → dual output for importers with exposure to both regimes.';

COMMENT ON COLUMN cbam.cbam_cases.carbon_price_paid_third_country_eur IS
    'Per-tonne carbon price (EUR/tCO2e) already paid in the goods'' country of '
    'origin under an EU-recognised third-country carbon pricing scheme '
    '(EU Regulation 2023/956, Article 9). NULL when no recognised scheme '
    'applies or the assessment is pending. Used in the EU XML output as '
    '<cbam:thirdCountryCarbonPrice> and in the UK HMRC return as carbon '
    'price relief. Assessment via POST /cbam/carbon-pricing-schemes.';

-- ---------------------------------------------------------------------------
-- From the former api/db/migrations/011_verification_fields.sql
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- From the former api/db/migrations/012_registration.sql
-- ---------------------------------------------------------------------------

-- Migration 012: CBAM registration management tables
-- ---------------------------------------------------------------------------
-- UK CBAM (Finance No.2 Bill 2025-26) requires importers to register with
-- HMRC if their rolling 12-month CBAM goods import value reaches £50,000.
--
-- Rolling window rules:
--   - Window opens 1 January 2027 and rolls monthly thereafter.
--   - On the first of each month importers must check:
--       (a) their rolling 12-month value (backwards), AND
--       (b) whether they expect to exceed £50,000 in the next 30 days.
--   - First registration deadline: 31 January 2028 (Year 1 annual filers).
--   - From 2028+: register by the first of the month following threshold breach.
--
-- Tables added:
--   cbam.cbam_registration      — one row per tenant; HMRC registration state
--   cbam.cbam_threshold_alerts  — monthly threshold check event log (dashboard)
--
-- Column added to existing table:
--   cbam.cbam_shipments.customs_value_gbp — customs transaction value used in
--   the rolling 12-month threshold sum.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Add import value tracking to shipments
--    customs_value_gbp: GBP value of the goods per customs entry.
--    NULL = not yet recorded (older rows).  Excluded from rolling sum.
-- ---------------------------------------------------------------------------
ALTER TABLE cbam.cbam_shipments
    ADD COLUMN IF NOT EXISTS customs_value_gbp DECIMAL(15, 2);

COMMENT ON COLUMN cbam.cbam_shipments.customs_value_gbp IS
    'Customs transaction value in GBP for this shipment/consignment. '
    'Summed over the rolling 12-month window to determine whether the '
    '£50,000 CBAM registration threshold has been reached. '
    'NULL rows are excluded from the sum (pre-migration shipments).';

-- Index for the rolling-window aggregation query (threshold check)
CREATE INDEX IF NOT EXISTS idx_cbam_shipments_import_date_value
    ON cbam.cbam_shipments (import_date)
    WHERE customs_value_gbp IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. cbam_registration — one row per tenant, UPSERT-safe (UNIQUE tenant_id)
--    Stores the HMRC registration state and the Government Gateway checklist
--    fields that importers must gather before registering.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cbam.cbam_registration (
    id                                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                            TEXT         UNIQUE NOT NULL,

    -- Government Gateway / HMRC mandatory fields
    eori_number                          VARCHAR(20),
    vat_number                           VARCHAR(20),
    business_name                        VARCHAR(200),
    business_address                     JSONB,

    -- Importer estimates (HMRC form fields for Year 1 declaration)
    cbam_goods_import_value_estimate_gbp DECIMAL(15, 2),
    cbam_goods_weight_estimate_kg        DECIMAL(15, 4),

    -- Registration lifecycle
    registration_status                  VARCHAR(20)  NOT NULL DEFAULT 'not_started'
        CHECK (registration_status IN (
            'not_started',   -- importer has not started the process
            'in_progress',   -- checklist partially filled; gathering documents
            'submitted',     -- submitted via Government Gateway; awaiting HMRC
            'confirmed'      -- HMRC has confirmed; registration_reference assigned
        )),
    registration_reference               VARCHAR(50),   -- HMRC reference (post-confirmation)
    registered_at                        DATE,          -- date HMRC confirmed registration

    created_at                           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at                           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE cbam.cbam_registration IS
    'One row per tenant tracking HMRC CBAM registration state and checklist '
    'completeness.  Upserted via PUT /api/cbam/registration.';

COMMENT ON COLUMN cbam.cbam_registration.eori_number IS
    'Economic Operators Registration and Identification number. '
    'Mandatory for UK CBAM registration via the Government Gateway.';

COMMENT ON COLUMN cbam.cbam_registration.vat_number IS
    'UK VAT registration number.  Required for HMRC identity verification.';

COMMENT ON COLUMN cbam.cbam_registration.business_address IS
    'Registered business address stored as JSON: '
    '{"line1":..., "line2":..., "city":..., "postcode":..., "country":...}';

COMMENT ON COLUMN cbam.cbam_registration.registration_reference IS
    'HMRC reference number assigned after the Government Gateway submission '
    'is confirmed.  NULL until registration_status = ''confirmed''.';

COMMENT ON COLUMN cbam.cbam_registration.registered_at IS
    'Date on which HMRC confirmed registration.  '
    'Importers must retain this date for 6-year record-keeping obligations.';

-- ---------------------------------------------------------------------------
-- 3. cbam_threshold_alerts — monthly check event log
--    One row per event (approaching / threshold_met / threshold_cleared).
--    Generated by the APScheduler job on the 1st of each month.
--    Surfaced on the importer dashboard until acknowledged.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cbam.cbam_threshold_alerts (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         TEXT        NOT NULL,

    alert_type        VARCHAR(50) NOT NULL
        CHECK (alert_type IN (
            'approaching_threshold',  -- value >= £40,000; prepare to register
            'threshold_met',          -- value >= £50,000; registration required
            'threshold_cleared'       -- value dropped below £40,000 again
        )),

    rolling_value_gbp DECIMAL(15, 2),   -- rolling 12-month import value at check time
    triggered_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    acknowledged_at   TIMESTAMPTZ,       -- NULL until importer dismisses the alert
    message           TEXT                -- human-readable action text
);

COMMENT ON TABLE cbam.cbam_threshold_alerts IS
    'Immutable log of monthly registration threshold check events. '
    'Importers acknowledge alerts to clear them from the dashboard action panel. '
    'Generated by the APScheduler job (day=1, hour=1 UTC each month).';

-- Fast lookup: recent alerts per tenant (dashboard badge / list view)
CREATE INDEX IF NOT EXISTS idx_cbam_threshold_alerts_tenant_time
    ON cbam.cbam_threshold_alerts (tenant_id, triggered_at DESC);

-- Partial index: unacknowledged alerts only (dashboard unread count)
CREATE INDEX IF NOT EXISTS idx_cbam_threshold_alerts_unacked
    ON cbam.cbam_threshold_alerts (tenant_id)
    WHERE acknowledged_at IS NULL;
