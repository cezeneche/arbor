-- Gap 5 — per-record access log for cross-organisation data sharing.
-- CreateEnum
CREATE TYPE "AccessMethod" AS ENUM ('API', 'PORTAL', 'EXPORT');

-- CreateTable
CREATE TABLE "RecordAccessLog" (
    "id" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "granteeEntityId" TEXT NOT NULL,
    "accessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accessMethod" "AccessMethod" NOT NULL,

    CONSTRAINT "RecordAccessLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecordAccessLog_recordId_idx" ON "RecordAccessLog"("recordId");
CREATE INDEX "RecordAccessLog_granteeEntityId_accessedAt_idx" ON "RecordAccessLog"("granteeEntityId", "accessedAt");

-- AddForeignKey
ALTER TABLE "RecordAccessLog" ADD CONSTRAINT "RecordAccessLog_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "DataRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
