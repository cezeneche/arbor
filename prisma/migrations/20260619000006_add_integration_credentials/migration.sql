-- Gap 9 — ERP / customs integration credentials (encrypted at rest).
-- CreateEnum
CREATE TYPE "IntegrationProvider" AS ENUM ('CDS', 'SAP', 'NETSUITE', 'ORACLE');

-- CreateTable
CREATE TABLE "IntegrationCredential" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "encryptedCredentials" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSyncAt" TIMESTAMP(3),
    "lastSyncStatus" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "IntegrationCredential_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationCredential_entityId_provider_key" ON "IntegrationCredential"("entityId", "provider");
CREATE INDEX "IntegrationCredential_provider_isActive_idx" ON "IntegrationCredential"("provider", "isActive");

-- AddForeignKey
ALTER TABLE "IntegrationCredential" ADD CONSTRAINT "IntegrationCredential_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
