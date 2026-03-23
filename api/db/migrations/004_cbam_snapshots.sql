-- Append-only audit snapshot table for CBAM calculation chain.
-- Each row is immutable once written; parent_hash chains them cryptographically.
-- TEXT columns for algo_versions/model_versions keep this compatible with SQLite in tests.

CREATE TABLE IF NOT EXISTS cbam.cbam_snapshots (
    id              TEXT        NOT NULL PRIMARY KEY,
    case_id         TEXT        NOT NULL,
    stage           TEXT        NOT NULL,
    created_at      TEXT        NOT NULL,
    payload_json    TEXT        NOT NULL,
    payload_hash    TEXT        NOT NULL,
    parent_hash     TEXT,
    algo_versions   TEXT        NOT NULL DEFAULT '{}',
    model_versions  TEXT        NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_cbam_snapshots_case_created
    ON cbam.cbam_snapshots(case_id, created_at);

CREATE INDEX IF NOT EXISTS idx_cbam_snapshots_case_stage_created
    ON cbam.cbam_snapshots(case_id, stage, created_at);
