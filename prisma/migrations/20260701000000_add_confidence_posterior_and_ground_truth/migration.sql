-- Upgrade 1 — Bayesian fusion + calibration substrate.
-- Additive only: a JSONB posterior sidecar on DataRecord and the
-- GroundTruthLabel training-signal table fed by human review decisions.

-- CreateEnum
CREATE TYPE "GroundTruthSource" AS ENUM ('REVIEW_CONFIRMED', 'REVIEW_CORRECTED');

-- AlterTable
ALTER TABLE "DataRecord" ADD COLUMN "confidencePosterior" JSONB;

-- CreateTable
CREATE TABLE "GroundTruthLabel" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "documentId" TEXT,
    "recordId" TEXT,
    "fieldName" TEXT NOT NULL,
    "documentClass" TEXT NOT NULL,
    "domain" "DataDomain" NOT NULL,
    "extractedValue" TEXT,
    "confirmedValue" TEXT,
    "wasCorrect" BOOLEAN NOT NULL,
    "confidenceAtExtraction" DOUBLE PRECISION NOT NULL,
    "source" "GroundTruthSource" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroundTruthLabel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GroundTruthLabel_fieldName_documentClass_idx" ON "GroundTruthLabel"("fieldName", "documentClass");

-- CreateIndex
CREATE INDEX "GroundTruthLabel_domain_createdAt_idx" ON "GroundTruthLabel"("domain", "createdAt");

-- CreateIndex
CREATE INDEX "GroundTruthLabel_entityId_idx" ON "GroundTruthLabel"("entityId");

-- AddForeignKey
ALTER TABLE "GroundTruthLabel" ADD CONSTRAINT "GroundTruthLabel_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroundTruthLabel" ADD CONSTRAINT "GroundTruthLabel_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;
