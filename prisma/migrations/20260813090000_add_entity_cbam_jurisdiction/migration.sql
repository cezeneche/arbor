-- Which CBAM regime an entity files under.
--
-- Replaces a hardcoded 'EU' in the extraction pipeline. Every existing entity
-- defaults to UK: Arbor is a UK-first product whose output is an HMRC return,
-- so an entity that has never been asked is a UK importer until it says
-- otherwise. Additive and non-destructive — one column with a default.
CREATE TYPE "CbamJurisdiction" AS ENUM ('UK', 'EU', 'BOTH');

ALTER TABLE "Entity" ADD COLUMN "cbamJurisdiction" "CbamJurisdiction" NOT NULL DEFAULT 'UK';
