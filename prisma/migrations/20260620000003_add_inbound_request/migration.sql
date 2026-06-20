-- Core 5 — email-forward inbound request handler.
-- CreateEnum
CREATE TYPE "InboundRequestStatus" AS ENUM ('NEW', 'ANSWERED', 'NEEDS_DATA');

-- CreateTable
CREATE TABLE "InboundRequest" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "fromEmail" TEXT,
    "rawText" TEXT NOT NULL,
    "parsedFields" JSONB,
    "status" "InboundRequestStatus" NOT NULL DEFAULT 'NEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answeredAt" TIMESTAMP(3),

    CONSTRAINT "InboundRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InboundRequest_entityId_status_idx" ON "InboundRequest"("entityId", "status");

-- CreateIndex
CREATE INDEX "InboundRequest_entityId_createdAt_idx" ON "InboundRequest"("entityId", "createdAt");

-- AddForeignKey
ALTER TABLE "InboundRequest" ADD CONSTRAINT "InboundRequest_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
