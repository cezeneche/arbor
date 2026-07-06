-- Upgrade 2 (active-learning) A/B instrumentation. Additive only: persist the
-- expected information gain the review UI ranked each field by, plus its
-- low-information verdict, onto the ground-truth label. Nullable — labels written
-- before this migration (and any non-review-sourced label) carry no ranking
-- signal. Enables the kill-signal measurement (do ranked-high fields get corrected
-- at a higher rate than random?) once reviewer traffic accumulates. No backfill.

-- AlterTable
ALTER TABLE "GroundTruthLabel" ADD COLUMN "expectedInformationGain" DOUBLE PRECISION;
ALTER TABLE "GroundTruthLabel" ADD COLUMN "lowInformation" BOOLEAN;
