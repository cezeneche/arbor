-- Add keyPrefix column to ApiKey for O(1) lookup without loading all keys.
-- Existing keys (if any) have no prefix stored; they must be regenerated.
ALTER TABLE "ApiKey" ADD COLUMN "keyPrefix" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ApiKey" ALTER COLUMN "keyPrefix" DROP DEFAULT;
CREATE UNIQUE INDEX "ApiKey_keyPrefix_key" ON "ApiKey"("keyPrefix");
