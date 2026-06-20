-- Gap 3 + Gap 4 — verifier and external-auditor roles, assignments, package log.

-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'VERIFIER';
ALTER TYPE "UserRole" ADD VALUE 'AUDITOR';

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('PENDING', 'IN_REVIEW', 'VERIFIED', 'REJECTED');

-- AlterTable: entityId becomes nullable for platform-level roles.
ALTER TABLE "User" ALTER COLUMN "entityId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "VerificationAssignment" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "verifierId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "verifierNote" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "signatureHash" TEXT,

    CONSTRAINT "VerificationAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditPackageLog" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "packageHash" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,

    CONSTRAINT "AuditPackageLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditorAccess" (
    "id" TEXT NOT NULL,
    "auditorUserId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditorAccess_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VerificationAssignment_verifierId_status_idx" ON "VerificationAssignment"("verifierId", "status");
CREATE INDEX "VerificationAssignment_entityId_status_idx" ON "VerificationAssignment"("entityId", "status");
CREATE INDEX "AuditPackageLog_entityId_packageHash_idx" ON "AuditPackageLog"("entityId", "packageHash");
CREATE INDEX "AuditorAccess_auditorUserId_entityId_idx" ON "AuditorAccess"("auditorUserId", "entityId");

-- AddForeignKey
ALTER TABLE "VerificationAssignment" ADD CONSTRAINT "VerificationAssignment_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VerificationAssignment" ADD CONSTRAINT "VerificationAssignment_verifierId_fkey" FOREIGN KEY ("verifierId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuditPackageLog" ADD CONSTRAINT "AuditPackageLog_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuditorAccess" ADD CONSTRAINT "AuditorAccess_auditorUserId_fkey" FOREIGN KEY ("auditorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuditorAccess" ADD CONSTRAINT "AuditorAccess_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
