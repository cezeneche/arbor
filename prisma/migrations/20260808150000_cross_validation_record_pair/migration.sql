-- Identify a cross-validation by the records it compared, not just the documents.
--
-- Two documents can hold several records for the same field, so the document pair
-- alone did not identify a comparison. Re-running cross-validation (a
-- re-confirmation, a retry, a backfill) therefore inserted another row and
-- another pair of flags every time, and the same finding was reported over and
-- over until the real backlog was out of sight.
--
-- Existing rows keep NULL record ids: Postgres treats NULLs as distinct in a
-- unique index, so they neither collide with each other nor block the new rows
-- that do carry ids.
ALTER TABLE "CrossValidationResult" ADD COLUMN IF NOT EXISTS "recordAId" TEXT;
ALTER TABLE "CrossValidationResult" ADD COLUMN IF NOT EXISTS "recordBId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "CrossValidationResult_pair_key"
  ON "CrossValidationResult"("documentAId", "documentBId", "fieldName", "recordAId", "recordBId");

CREATE INDEX IF NOT EXISTS "CrossValidationResult_entityId_createdAt_idx"
  ON "CrossValidationResult"("entityId", "createdAt");
