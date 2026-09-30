-- Audit narratives for CBAM cases, as Nucleos wrote them, with the
-- validator's review verdict. Append-only. Additive.

-- CreateTable
CREATE TABLE "CbamNarrative" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "nucleosCaseId" TEXT NOT NULL,
    "generatedById" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewRequired" BOOLEAN NOT NULL,
    "reviewReasons" JSONB NOT NULL,
    "narrative" JSONB NOT NULL,
    "packHash" TEXT,
    "emailedAt" TIMESTAMP(3),

    CONSTRAINT "CbamNarrative_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CbamNarrative_entityId_nucleosCaseId_generatedAt_idx" ON "CbamNarrative"("entityId", "nucleosCaseId", "generatedAt");

-- AddForeignKey
ALTER TABLE "CbamNarrative" ADD CONSTRAINT "CbamNarrative_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
