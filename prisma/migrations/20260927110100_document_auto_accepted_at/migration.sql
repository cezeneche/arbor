-- Auto-accepted documents were saved Declared with a promise that a later check
-- could make them Verified, but nothing recorded which documents they were, so
-- neither the review queue nor the weekly digest could find them.
-- AlterTable
ALTER TABLE "Document" ADD COLUMN "autoAcceptedAt" TIMESTAMP(3);

-- Existing auto-accepted documents, identified conservatively: accepted, of a
-- type that is auto-accepted at all, every record Declared and document-read,
-- and no review labels — a person confirming writes one per field checked. A
-- document marked here wrongly can simply be confirmed again; one missed keeps
-- the upgrade path it never had.
UPDATE "Document" d
SET "autoAcceptedAt" = r.first_at
FROM (
  SELECT "documentId", MIN("submittedAt") AS first_at
  FROM "DataRecord"
  WHERE "documentId" IS NOT NULL
  GROUP BY "documentId"
  HAVING bool_and("trustTier" = 'B' AND "extractionMethod" = 'DOCUMENT_AI')
) r
WHERE d.id = r."documentId"
  AND d.status = 'ACCEPTED'
  AND d."documentType"::text NOT IN (
    'CBAM_DECLARATION', 'CUSTOMS_DECLARATION', 'PRODUCT_CERTIFICATE',
    'ENVIRONMENTAL_CERTIFICATE', 'RENEWABLE_CERTIFICATE', 'LAND_USE_CERTIFICATE',
    'CHAIN_OF_CUSTODY'
  )
  AND NOT EXISTS (SELECT 1 FROM "GroundTruthLabel" g WHERE g."documentId" = d.id);
