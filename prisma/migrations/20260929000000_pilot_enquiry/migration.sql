CREATE TABLE "PilotEnquiry" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "orgName" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "audience" TEXT NOT NULL,
    "plan" TEXT,
    "message" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PilotEnquiry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PilotEnquiry_status_createdAt_idx" ON "PilotEnquiry"("status", "createdAt");
CREATE UNIQUE INDEX "PilotEnquiry_requestId_key" ON "PilotEnquiry"("requestId");

ALTER TABLE "InstitutionalEnquiry" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'NEW';
ALTER TABLE "InstitutionalEnquiry" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX "InstitutionalEnquiry_status_createdAt_idx" ON "InstitutionalEnquiry"("status", "createdAt");
