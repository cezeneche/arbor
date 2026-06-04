-- Phase 3: sector benchmarks, derived factor CI fields, entity consent flag

-- Add benchmark aggregation consent flag to Entity
ALTER TABLE "Entity" ADD COLUMN "allowBenchmarkAggregation" BOOLEAN NOT NULL DEFAULT false;

-- Add confidence interval and sample size to EmissionFactor (for derived factors)
ALTER TABLE "EmissionFactor" ADD COLUMN "confidenceIntervalLower" DOUBLE PRECISION;
ALTER TABLE "EmissionFactor" ADD COLUMN "confidenceIntervalUpper" DOUBLE PRECISION;
ALTER TABLE "EmissionFactor" ADD COLUMN "sampleSize" INTEGER;

-- Create SectorBenchmark table
CREATE TABLE "SectorBenchmark" (
    "id"           TEXT NOT NULL,
    "sector"       TEXT NOT NULL,
    "domain"       "DataDomain" NOT NULL,
    "fieldName"    TEXT NOT NULL,
    "unit"         TEXT NOT NULL,
    "year"         INTEGER NOT NULL,
    "minValue"     DOUBLE PRECISION NOT NULL,
    "maxValue"     DOUBLE PRECISION NOT NULL,
    "meanValue"    DOUBLE PRECISION NOT NULL,
    "medianValue"  DOUBLE PRECISION NOT NULL,
    "stddevValue"  DOUBLE PRECISION NOT NULL,
    "entityCount"  INTEGER NOT NULL,
    "tierAPercent" DOUBLE PRECISION NOT NULL,
    "computedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SectorBenchmark_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SectorBenchmark_sector_domain_fieldName_year_key"
    ON "SectorBenchmark"("sector", "domain", "fieldName", "year");
