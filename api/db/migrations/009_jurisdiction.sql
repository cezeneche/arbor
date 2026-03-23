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
