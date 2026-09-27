-- CBAM appeared in every organisation's navigation. It now appears when there
-- is CBAM activity (decided at request time, so no backfill is needed) or when
-- the organisation switches it on, which this records. Additive.
-- AlterTable
ALTER TABLE "Entity" ADD COLUMN "cbamEnabled" BOOLEAN NOT NULL DEFAULT false;
