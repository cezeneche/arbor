-- Two benchmark corrections.
--
-- 1. Unit belongs in the SectorBenchmark key.
--    Benchmarks are computed per sector+domain+field+UNIT — a field recorded in MJ
--    by some entities and kWh by others is two distributions, not one — but the
--    unique key omitted the unit, so the second upsert overwrote the first and
--    whichever unit was processed last silently became "the" benchmark.
--    Duplicates are collapsed to the most recently computed row per new key before
--    the index is created, since only one of them was ever visible anyway.
--
-- 2. A ledger of differentially-private releases.
--    DP protects a single release, not a series. Drawing fresh Laplace noise over
--    identical values on every request let a caller loop the endpoint and average
--    the answers back to the true figure. Releases are now recorded against the
--    group, the epsilon and a fingerprint of the values, and an identical request
--    replays the release already made.

DELETE FROM "SectorBenchmark" a
USING "SectorBenchmark" b
WHERE a."sector" = b."sector"
  AND a."domain" = b."domain"
  AND a."fieldName" = b."fieldName"
  AND a."unit" = b."unit"
  AND a."year" = b."year"
  AND (a."computedAt" < b."computedAt" OR (a."computedAt" = b."computedAt" AND a."id" < b."id"));

DROP INDEX IF EXISTS "SectorBenchmark_sector_domain_fieldName_year_key";

CREATE UNIQUE INDEX IF NOT EXISTS "SectorBenchmark_sector_domain_field_unit_year_key"
  ON "SectorBenchmark"("sector", "domain", "fieldName", "unit", "year");

CREATE TABLE IF NOT EXISTS "DpBenchmarkRelease" (
  "id"               TEXT NOT NULL,
  "groupKey"         TEXT NOT NULL,
  "epsilon"          DOUBLE PRECISION NOT NULL,
  "inputFingerprint" TEXT NOT NULL,
  "suppressed"       BOOLEAN NOT NULL,
  "n"                INTEGER NOT NULL,
  "dpMean"           DOUBLE PRECISION,
  "dpCount"          DOUBLE PRECISION,
  "releasedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "DpBenchmarkRelease_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DpBenchmarkRelease_group_epsilon_fingerprint_key"
  ON "DpBenchmarkRelease"("groupKey", "epsilon", "inputFingerprint");

CREATE INDEX IF NOT EXISTS "DpBenchmarkRelease_releasedAt_idx"
  ON "DpBenchmarkRelease"("releasedAt");
