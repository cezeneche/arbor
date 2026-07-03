-- Upgrade 5 (entity resolution). Additive only: a non-destructive "same
-- real-world entity" edge between two Entity rows, proposed by the resolution
-- job and confirmed/rejected by a human. Never mutates entities or records.

-- CreateEnum
CREATE TYPE "EntityLinkStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED');

-- CreateEnum
CREATE TYPE "EntityLinkRelation" AS ENUM ('SAME_AS');

-- CreateTable
CREATE TABLE "EntityLink" (
    "id" TEXT NOT NULL,
    "entityAId" TEXT NOT NULL,
    "entityBId" TEXT NOT NULL,
    "relation" "EntityLinkRelation" NOT NULL DEFAULT 'SAME_AS',
    "similarity" DOUBLE PRECISION NOT NULL,
    "suggestedDecision" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "status" "EntityLinkStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EntityLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EntityLink_entityAId_entityBId_key" ON "EntityLink"("entityAId", "entityBId");

-- CreateIndex
CREATE INDEX "EntityLink_status_createdAt_idx" ON "EntityLink"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "EntityLink" ADD CONSTRAINT "EntityLink_entityAId_fkey" FOREIGN KEY ("entityAId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntityLink" ADD CONSTRAINT "EntityLink_entityBId_fkey" FOREIGN KEY ("entityBId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntityLink" ADD CONSTRAINT "EntityLink_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
