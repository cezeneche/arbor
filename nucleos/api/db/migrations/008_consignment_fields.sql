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
