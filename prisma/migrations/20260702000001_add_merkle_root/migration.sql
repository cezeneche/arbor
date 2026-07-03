-- Upgrade 7 (Merkle-DAG productization). Additive only: a committed RFC 6962
-- root over the ordered per-record auditHash leaves for an entity+period,
-- persisted when an audit package is generated. Additive over the linear HMAC
-- chain — it never replaces it.

-- CreateTable
CREATE TABLE "MerkleRoot" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "root" TEXT NOT NULL,
    "leafCount" INTEGER NOT NULL,
    "algorithm" TEXT NOT NULL DEFAULT 'RFC6962-SHA256',
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "packageHash" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MerkleRoot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MerkleRoot_entityId_root_idx" ON "MerkleRoot"("entityId", "root");

-- CreateIndex
CREATE INDEX "MerkleRoot_entityId_generatedAt_idx" ON "MerkleRoot"("entityId", "generatedAt");

-- AddForeignKey
ALTER TABLE "MerkleRoot" ADD CONSTRAINT "MerkleRoot_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
