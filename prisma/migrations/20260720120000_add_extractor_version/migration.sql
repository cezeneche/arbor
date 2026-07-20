-- MLOps guardrail: stamp the extractor (model id + prompt version) that produced
-- an extraction, so a later accuracy regression is attributable to the exact
-- model/prompt change that caused it. Additive and nullable — existing rows keep
-- NULL (pre-stamping), nothing changes behaviour.

ALTER TABLE "ExtractionJob" ADD COLUMN "extractorVersion" TEXT;

ALTER TABLE "GroundTruthLabel" ADD COLUMN "extractorVersion" TEXT;

-- The accuracy monitor slices correct-rate by extractor over recent windows.
CREATE INDEX "GroundTruthLabel_extractorVersion_createdAt_idx" ON "GroundTruthLabel"("extractorVersion", "createdAt");
