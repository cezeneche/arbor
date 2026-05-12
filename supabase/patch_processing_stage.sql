-- Adds processing_stage and processing_error to cbam_cases so the pipeline
-- can broadcast granular progress and the UI can show real step labels.
ALTER TABLE cbam.cbam_cases
  ADD COLUMN IF NOT EXISTS processing_stage TEXT,
  ADD COLUMN IF NOT EXISTS processing_error TEXT;

-- Extend the status constraint to allow 'error' (required by _mark_error).
ALTER TABLE cbam.cbam_cases
  DROP CONSTRAINT IF EXISTS cbam_cases_status_check;
ALTER TABLE cbam.cbam_cases
  ADD CONSTRAINT cbam_cases_status_check
  CHECK (status IN ('draft','submitted','processing','approved','rejected','error'));
