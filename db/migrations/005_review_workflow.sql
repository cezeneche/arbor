-- 005_review_workflow.sql
-- Persistent human-approval state for the narrative review gate.
--
-- review_status values:
--   NULL             — not flagged (pipeline passed, or not yet run)
--   'pending_review' — Gemini flagged; reviewer action required before bundling
--   'approved'       — reviewer approved; cases.status advances to 'signed_off'
--   'rejected'       — reviewer rejected; operator must correct data and re-run pipeline
--
-- State machine:
--   null → pending_review (pipeline flags)
--   pending_review → approved (reviewer approves; cases.status → signed_off)
--   pending_review → rejected (reviewer rejects)
--   rejected → null (pipeline re-runs cleanly)
--   rejected/pending_review → pending_review (pipeline re-runs and fails again)
--   approved → approved (terminal; no mutation)

ALTER TABLE cases ADD COLUMN IF NOT EXISTS review_status TEXT;

-- Record WHO reviewed (JWT sub) alongside the human-readable reviewer_name.
ALTER TABLE signoffs ADD COLUMN IF NOT EXISTS actor_sub TEXT;

-- Fast lookup of cases awaiting review
CREATE INDEX IF NOT EXISTS idx_cases_review_status
    ON cases(review_status) WHERE review_status IS NOT NULL;
