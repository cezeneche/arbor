-- Add keyPrefix column to ApiKey for O(1) lookup without loading all keys.
-- Existing keys (if any) have no prefix stored; backfill with the row id so
-- each row gets a guaranteed-unique value before the unique index is created.
ALTER TABLE "ApiKey" ADD COLUMN "keyPrefix" TEXT NOT NULL DEFAULT '';
UPDATE "ApiKey" SET "keyPrefix" = id WHERE "keyPrefix" = '';
ALTER TABLE "ApiKey" ALTER COLUMN "keyPrefix" DROP DEFAULT;
CREATE UNIQUE INDEX "ApiKey_keyPrefix_key" ON "ApiKey"("keyPrefix");
