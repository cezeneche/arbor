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
    tenant_id                            UUID         UNIQUE NOT NULL,

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
    tenant_id         UUID        NOT NULL,

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
