-- Gap 1 — Layer 1 multilingual + degraded-document metadata on ExtractionJob.
-- AlterTable
ALTER TABLE "ExtractionJob" ADD COLUMN     "detectedLanguage" TEXT,
ADD COLUMN     "imageQualityScore" DOUBLE PRECISION,
ADD COLUMN     "imageQualityIssues" JSONB;
