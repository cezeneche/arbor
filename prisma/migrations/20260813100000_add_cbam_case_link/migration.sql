-- The record of one CBAM handoff: which confirmed document produced which
-- Nucleos case, under which regime, and what did not land.
--
-- Not a mirror of the case — cases stay Nucleos's domain state. This is the
-- correlation handle plus the honest report of a partial handoff, which has
-- nowhere else to live: a case created without one of its goods lines is
-- indistinguishable from a complete one from the outside.
--
-- Additive: one enum, one table, no change to any existing row.
CREATE TYPE "CbamHandoffStatus" AS ENUM ('CREATED', 'PARTIAL', 'FAILED');

CREATE TABLE "CbamCaseLink" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "nucleosCaseId" TEXT,
    "jurisdiction" "CbamJurisdiction" NOT NULL,
    "status" "CbamHandoffStatus" NOT NULL DEFAULT 'CREATED',
    "problems" TEXT[],
    "goodsLineCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CbamCaseLink_pkey" PRIMARY KEY ("id")
);

-- One case per confirmed document. This is what stops a retried confirmation
-- opening a second case for one real-world declaration.
CREATE UNIQUE INDEX "CbamCaseLink_documentId_key" ON "CbamCaseLink"("documentId");

CREATE INDEX "CbamCaseLink_entityId_createdAt_idx" ON "CbamCaseLink"("entityId", "createdAt");

ALTER TABLE "CbamCaseLink" ADD CONSTRAINT "CbamCaseLink_entityId_fkey"
    FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CbamCaseLink" ADD CONSTRAINT "CbamCaseLink_documentId_fkey"
    FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
