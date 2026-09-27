-- Accredited verifiers' statements for CBAM goods lines. The file is in the
-- private documents bucket; Nucleos records a reference to the row and the
-- file's SHA-256. Additive.

-- CreateEnum
CREATE TYPE "CbamVerificationSubject" AS ENUM ('EMISSIONS', 'RELIEF');

-- CreateEnum
CREATE TYPE "CbamVerificationStatus" AS ENUM ('SUBMITTED', 'ACCEPTED', 'REJECTED');

-- CreateTable
CREATE TABLE "CbamVerificationStatement" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "nucleosCaseId" TEXT NOT NULL,
    "goodsLineId" TEXT NOT NULL,
    "subject" "CbamVerificationSubject" NOT NULL DEFAULT 'EMISSIONS',
    "storagePath" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "verifierName" TEXT NOT NULL,
    "verifierAccreditation" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "CbamVerificationStatus" NOT NULL DEFAULT 'SUBMITTED',
    "syncedAt" TIMESTAMP(3),
    "syncError" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,

    CONSTRAINT "CbamVerificationStatement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CbamVerificationStatement_entityId_nucleosCaseId_idx" ON "CbamVerificationStatement"("entityId", "nucleosCaseId");

-- CreateIndex
CREATE INDEX "CbamVerificationStatement_goodsLineId_idx" ON "CbamVerificationStatement"("goodsLineId");

-- AddForeignKey
ALTER TABLE "CbamVerificationStatement" ADD CONSTRAINT "CbamVerificationStatement_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
