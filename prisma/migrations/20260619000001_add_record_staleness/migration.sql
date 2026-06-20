-- Gap 2 — batch/mill record staleness + expiry notification types.
-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'CERTIFICATE_EXPIRING';
ALTER TYPE "NotificationType" ADD VALUE 'CERTIFICATE_EXPIRED';
ALTER TYPE "NotificationType" ADD VALUE 'RECORD_SUPERSEDED';

-- AlterEnum
ALTER TYPE "FlagType" ADD VALUE 'STALE_RECORD';

-- AlterTable
ALTER TABLE "DataRecord" ADD COLUMN     "staleAfterDate" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "DataRecord_entityId_staleAfterDate_idx" ON "DataRecord"("entityId", "staleAfterDate");
