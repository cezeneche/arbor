-- Data governance: agreed business definitions + named stewardship.
--
-- Two gaps this closes:
--   1. Field meanings lived as TypeScript constants — no versioning, no effective
--      dates, no human-readable wording, and no record that a buyer and supplier
--      ever agreed what a field means. FieldDefinition + DefinitionAgreement make
--      the definition a governed, versioned, bilaterally agreed artefact that
--      travels with every exported record.
--   2. A ValidationFlag had resolvedAt but no assignee — an open CRITICAL was
--      nobody's job. DomainSteward names an accountable owner per (entity, domain)
--      and flags now carry an owner, a proportionate deadline, and an escalation
--      stamp.
--
-- Additive throughout. No existing column changes type or nullability, and no
-- certified record is touched.

-- ── Enums ─────────────────────────────────────────────────────────────────────

CREATE TYPE "AgreementStatus" AS ENUM ('PROPOSED', 'ACCEPTED', 'REJECTED', 'WITHDRAWN');

ALTER TYPE "NotificationType" ADD VALUE 'DEFINITION_PROPOSED';
ALTER TYPE "NotificationType" ADD VALUE 'DEFINITION_AGREED';
ALTER TYPE "NotificationType" ADD VALUE 'DEFINITION_SUPERSEDED';
ALTER TYPE "NotificationType" ADD VALUE 'FLAG_ASSIGNED';
ALTER TYPE "NotificationType" ADD VALUE 'FLAG_OVERDUE';

-- ── Governed data dictionary ──────────────────────────────────────────────────
-- Versioned by effective date, never edited in place. [effectiveFrom, effectiveTo)
-- is half-open so a cutover instant belongs to exactly one version.

CREATE TABLE "FieldDefinition" (
    "id" TEXT NOT NULL,
    "fieldName" TEXT NOT NULL,
    "domain" "DataDomain" NOT NULL,
    "version" INTEGER NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "label" TEXT NOT NULL,
    "definition" TEXT NOT NULL,
    "boundary" TEXT NOT NULL,
    "canonicalUnit" TEXT,
    "admissibility" "FieldAdmissibility" NOT NULL,
    "sourceStandard" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "FieldDefinition_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FieldDefinition_fieldName_domain_version_key"
    ON "FieldDefinition"("fieldName", "domain", "version");
CREATE INDEX "FieldDefinition_fieldName_domain_effectiveFrom_idx"
    ON "FieldDefinition"("fieldName", "domain", "effectiveFrom");
CREATE INDEX "FieldDefinition_domain_effectiveTo_idx"
    ON "FieldDefinition"("domain", "effectiveTo");

ALTER TABLE "FieldDefinition" ADD CONSTRAINT "FieldDefinition_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Bilateral agreement ───────────────────────────────────────────────────────
-- Keyed to a definition version, not a field name: when the wording changes the
-- old agreement does not silently carry forward.

CREATE TABLE "DefinitionAgreement" (
    "id" TEXT NOT NULL,
    "fieldDefinitionId" TEXT NOT NULL,
    "definitionVersion" INTEGER NOT NULL,
    "supplierEntityId" TEXT NOT NULL,
    "buyerEntityId" TEXT NOT NULL,
    "status" "AgreementStatus" NOT NULL DEFAULT 'PROPOSED',
    "proposedByEntityId" TEXT NOT NULL,
    "proposedById" TEXT NOT NULL,
    "proposedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedById" TEXT,
    "respondedAt" TIMESTAMP(3),
    "note" TEXT,

    CONSTRAINT "DefinitionAgreement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DefinitionAgreement_definition_supplier_buyer_key"
    ON "DefinitionAgreement"("fieldDefinitionId", "supplierEntityId", "buyerEntityId");
CREATE INDEX "DefinitionAgreement_supplierEntityId_status_idx"
    ON "DefinitionAgreement"("supplierEntityId", "status");
CREATE INDEX "DefinitionAgreement_buyerEntityId_status_idx"
    ON "DefinitionAgreement"("buyerEntityId", "status");

ALTER TABLE "DefinitionAgreement" ADD CONSTRAINT "DefinitionAgreement_fieldDefinitionId_fkey"
    FOREIGN KEY ("fieldDefinitionId") REFERENCES "FieldDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DefinitionAgreement" ADD CONSTRAINT "DefinitionAgreement_supplierEntityId_fkey"
    FOREIGN KEY ("supplierEntityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DefinitionAgreement" ADD CONSTRAINT "DefinitionAgreement_buyerEntityId_fkey"
    FOREIGN KEY ("buyerEntityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DefinitionAgreement" ADD CONSTRAINT "DefinitionAgreement_proposedById_fkey"
    FOREIGN KEY ("proposedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DefinitionAgreement" ADD CONSTRAINT "DefinitionAgreement_respondedById_fkey"
    FOREIGN KEY ("respondedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Domain steward ────────────────────────────────────────────────────────────
-- Accountability for a domain's quality, distinct from authorship of a row.

CREATE TABLE "DomainSteward" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "domain" "DataDomain" NOT NULL,
    "userId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedById" TEXT NOT NULL,

    CONSTRAINT "DomainSteward_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DomainSteward_entityId_domain_key" ON "DomainSteward"("entityId", "domain");
CREATE INDEX "DomainSteward_userId_idx" ON "DomainSteward"("userId");

ALTER TABLE "DomainSteward" ADD CONSTRAINT "DomainSteward_entityId_fkey"
    FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DomainSteward" ADD CONSTRAINT "DomainSteward_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Flag ownership and proportionate deadline ─────────────────────────────────
-- Existing flags keep NULL on every new column: they are unowned and have no
-- deadline, which is the honest description of their current state. They surface
-- in the Unassigned bucket of the workload summary rather than being backfilled
-- with a fabricated owner.

ALTER TABLE "ValidationFlag" ADD COLUMN "assigneeId" TEXT;
ALTER TABLE "ValidationFlag" ADD COLUMN "assignedAt" TIMESTAMP(3);
ALTER TABLE "ValidationFlag" ADD COLUMN "assignedVia" TEXT;
ALTER TABLE "ValidationFlag" ADD COLUMN "dueAt" TIMESTAMP(3);
ALTER TABLE "ValidationFlag" ADD COLUMN "escalatedAt" TIMESTAMP(3);

CREATE INDEX "ValidationFlag_assigneeId_resolvedAt_idx"
    ON "ValidationFlag"("assigneeId", "resolvedAt");
CREATE INDEX "ValidationFlag_dueAt_resolvedAt_escalatedAt_idx"
    ON "ValidationFlag"("dueAt", "resolvedAt", "escalatedAt");

ALTER TABLE "ValidationFlag" ADD CONSTRAINT "ValidationFlag_assigneeId_fkey"
    FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
