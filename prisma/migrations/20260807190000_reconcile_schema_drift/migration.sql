-- Reconcile the committed migration history with schema.prisma.
--
-- Several schema changes reached the live database out of band and were never
-- written as migrations, so `prisma migrate deploy` against an empty database
-- produced a schema the application could not query (Entity.entityType did not
-- exist, and the app reads it on nearly every portal page). This migration is
-- the missing history.
--
-- EVERY STATEMENT IS IDEMPOTENT, and deliberately so. The live database already
-- has most of what follows; production runs `prisma migrate deploy` as the first
-- half of its build command, so a plain `ADD COLUMN` here would abort the build
-- on "column already exists" and take a deploy down. Guarded, this migration is
-- a no-op where the change is already present and applies it where it is not —
-- which is exactly what reconciling drift requires.
--
-- Verified against both states before committing: a database built only from the
-- committed migrations, and the live database's actual catalogue.

-- CreateEnum: EntityType (present live, absent from migration history).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'EntityType') THEN
    CREATE TYPE "EntityType" AS ENUM ('SUPPLIER', 'BUYER');
  END IF;
END $$;

-- AlterEnum: drop the retired DEFAULT_FACTOR member from ExtractionMethod.
-- Postgres cannot remove an enum member in place, so the type is rebuilt — but
-- only when the member is still there, which is what makes this safe to re-run.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'ExtractionMethod' AND e.enumlabel = 'DEFAULT_FACTOR'
  ) THEN
    CREATE TYPE "ExtractionMethod_new" AS ENUM ('DOCUMENT_AI', 'MANUAL_ENTRY', 'SYSTEM_INTEGRATION');
    ALTER TABLE "DataRecord"
      ALTER COLUMN "extractionMethod" TYPE "ExtractionMethod_new"
      USING ("extractionMethod"::text::"ExtractionMethod_new");
    ALTER TYPE "ExtractionMethod" RENAME TO "ExtractionMethod_old";
    ALTER TYPE "ExtractionMethod_new" RENAME TO "ExtractionMethod";
    DROP TYPE "public"."ExtractionMethod_old";
  END IF;
END $$;

-- DropTable: EmissionFactor. Nothing references it, and neither schema.prisma
-- nor any source file mentions it — Arbor stores operational data and does not
-- hold emission factors, because it does not calculate (PRD §14.3, §25).
-- Dropping the table takes its own foreign key with it.
DROP TABLE IF EXISTS "EmissionFactor";

-- AlterTable: scope3Category was a calculation-era column; unused everywhere.
ALTER TABLE "DataRecord" DROP COLUMN IF EXISTS "scope3Category";

-- AlterTable: Entity.entityType — the supplier/buyer split the portal branches
-- on for every screen.
ALTER TABLE "Entity" ADD COLUMN IF NOT EXISTS "entityType" "EntityType" NOT NULL DEFAULT 'SUPPLIER';

-- Re-point User.entityId at the referential action Prisma's schema declares.
-- The relation is optional (`entity Entity?`), for which Prisma expects
-- ON DELETE SET NULL; both the migration history and the live database still
-- carry the original RESTRICT. This is the one statement here that changes the
-- live database rather than matching it.
ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "User_entityId_fkey";
ALTER TABLE "User" ADD CONSTRAINT "User_entityId_fkey"
  FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
