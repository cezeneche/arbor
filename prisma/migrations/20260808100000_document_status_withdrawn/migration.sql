-- A document that was accepted and then removed by the user.
--
-- Its records are deactivated rather than deleted (the audit chain is
-- append-only), so the document itself cannot simply disappear either: the
-- records still point at it and that provenance is the point. WITHDRAWN is a
-- separate value from REJECTED because REJECTED means the file could not be
-- read, and the Overview offers to help with those.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'DocumentStatus' AND e.enumlabel = 'WITHDRAWN'
  ) THEN
    ALTER TYPE "DocumentStatus" ADD VALUE 'WITHDRAWN';
  END IF;
END
$$;
