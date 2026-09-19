-- Idempotent /api/v1/ingest batches.
--
-- The idempotency marker used to be an audit entry written after the whole
-- batch, so a crash before it duplicated every record on retry and concurrent
-- copies of one request both passed the check. The key is now reserved first,
-- as a unique (entityId, idempotencyKey) row, and each item's outcome commits
-- with its record. Additive: one enum, one table.
-- CreateEnum
CREATE TYPE "IngestOperationStatus" AS ENUM ('IN_PROGRESS', 'PARTIAL', 'COMPLETE');

-- CreateTable
CREATE TABLE "IngestOperation" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestDigest" TEXT NOT NULL,
    "status" "IngestOperationStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "results" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IngestOperation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IngestOperation_entityId_idempotencyKey_key" ON "IngestOperation"("entityId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "IngestOperation" ADD CONSTRAINT "IngestOperation_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

