-- Frozen shares. A share records the records it was issued with, which is the
-- set its integrity hash covers, and shows those, marking any corrected since.
-- Existing shares get an empty list and keep their live scope. Additive.
-- AlterTable
ALTER TABLE "SharedExport" ADD COLUMN     "recordIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

