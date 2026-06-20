-- Core 2 — signed shareable export.
-- CreateTable
CREATE TABLE "SharedExport" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "domain" "DataDomain",
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "packageHash" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "SharedExport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SharedExport_token_key" ON "SharedExport"("token");

-- CreateIndex
CREATE INDEX "SharedExport_entityId_createdAt_idx" ON "SharedExport"("entityId", "createdAt");

-- AddForeignKey
ALTER TABLE "SharedExport" ADD CONSTRAINT "SharedExport_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
