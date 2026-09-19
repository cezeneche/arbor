-- A CBAM handoff that can be resumed.
--
-- The handoff used to run once, after the confirmation committed, with its
-- input held only in the request. A failure told the user to confirm again,
-- which the confirm route refuses for an accepted document — so a failed
-- handoff could never be retried, and a partial one could never be finished.
--
-- The confirmation now records the handoff as PENDING in its own transaction,
-- with the input it needs; progress is written after every step so a resume
-- adds only what is missing. Additive: one enum value, four columns, one index.
ALTER TYPE "CbamHandoffStatus" ADD VALUE IF NOT EXISTS 'PENDING';

ALTER TABLE "CbamCaseLink"
    ADD COLUMN "handoffInput" JSONB,
    ADD COLUMN "progress" JSONB,
    ADD COLUMN "attemptStartedAt" TIMESTAMP(3),
    ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "CbamCaseLink_status_updatedAt_idx" ON "CbamCaseLink"("status", "updatedAt");
