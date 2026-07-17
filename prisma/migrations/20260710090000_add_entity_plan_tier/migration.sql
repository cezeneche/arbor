-- Plan tiers driving usage limits. Every existing entity defaults to PILOT
-- (uncapped) so nothing changes behaviour until a tier is assigned.
CREATE TYPE "PlanTier" AS ENUM ('PILOT', 'STARTER', 'MICRO', 'SMALL', 'GROWTH', 'STANDARD', 'BUSINESS', 'ENTERPRISE');

ALTER TABLE "Entity" ADD COLUMN "planTier" "PlanTier" NOT NULL DEFAULT 'PILOT';
