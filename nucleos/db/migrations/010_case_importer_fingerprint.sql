-- One case per importer per period, enforced on a value that can be compared.
--
-- cbam_cases carries a UNIQUE constraint on
-- (tenant_id, importer_eori, reporting_year, reporting_quarter), which reads
-- as "one case per importer per period". It has never been able to fire:
-- importer_eori is encrypted with Fernet, which is randomised, so the same
-- EORI encrypts differently every time and no two rows ever collide. An inert
-- constraint is worse than none — it looks like a guarantee.
--
-- What made this visible: Arbor posted a case, the request timed out against a
-- cold start that had in fact succeeded, and a retry would have opened a second
-- case for the same declaration. Two cases for one import is double counting.
--
-- importer_eori_hash is a keyed fingerprint of the same value: deterministic,
-- so equality works, and not reversible, so the plaintext is still not stored.

ALTER TABLE cbam.cbam_cases
    ADD COLUMN IF NOT EXISTS importer_eori_hash TEXT;

COMMENT ON COLUMN cbam.cbam_cases.importer_eori_hash IS
    'Keyed HMAC of importer_eori. Deterministic so one case per importer per period can be enforced; the plaintext lives only in the encrypted column.';

-- Partial: rows written before this column existed have no fingerprint and must
-- not collide with each other.
CREATE UNIQUE INDEX IF NOT EXISTS cbam_cases_unique_period_hashed
    ON cbam.cbam_cases (tenant_id, importer_eori_hash, reporting_year, reporting_quarter)
    WHERE importer_eori_hash IS NOT NULL;

-- The original constraint is dropped rather than left beside its replacement:
-- keeping a constraint that cannot fire is what allowed this to go unnoticed.
ALTER TABLE cbam.cbam_cases
    DROP CONSTRAINT IF EXISTS cbam_cases_unique_period;
