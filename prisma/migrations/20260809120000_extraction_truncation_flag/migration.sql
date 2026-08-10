-- Truncation of source material is recorded, never silent.
--
-- An extraction that fails is visible: the document is REJECTED and the reviewer
-- is told. An extraction that reads only part of the document is not — the
-- fields it produces look identical to a complete read. The reviewer confirms
-- them, and that confirmation is what sets the provenance tier on the resulting
-- record. So a partial read quietly produces a VERIFIED record backed by a
-- document nobody read in full.
--
-- Both columns are set together by whatever imposed the limit (a page cap, a
-- size limit, a truncated OCR pass). Existing jobs default to false: they were
-- produced by a path that does not truncate, so false is accurate rather than
-- merely convenient.

ALTER TABLE "ExtractionJob"
  ADD COLUMN "truncated" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "truncationReason" TEXT;
