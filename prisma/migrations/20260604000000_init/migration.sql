-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'CONTRIBUTOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('ELECTRICITY_BILL', 'GAS_BILL', 'FUEL_RECEIPT', 'RENEWABLE_CERTIFICATE', 'PRODUCTION_LOG', 'MATERIAL_INTAKE', 'BILL_OF_MATERIALS', 'PROCESS_DATA_SHEET', 'FREIGHT_INVOICE', 'DELIVERY_NOTE', 'CUSTOMS_DECLARATION', 'BILL_OF_LADING', 'SUPPLIER_INVOICE', 'PURCHASE_ORDER', 'SUPPLIER_QUESTIONNAIRE', 'EMISSIONS_FACTOR_DOC', 'ENVIRONMENTAL_CERTIFICATE', 'CARBON_FOOTPRINT_REPORT', 'WATER_RECORD', 'WASTE_RECORD', 'CROP_YIELD_RECORD', 'FERTILISER_RECORD', 'LIVESTOCK_RECORD', 'LAND_USE_CERTIFICATE', 'CBAM_DECLARATION', 'ESG_REPORT', 'AUDIT_REPORT', 'PRODUCT_CERTIFICATE', 'CHAIN_OF_CUSTODY', 'OTHER');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('PENDING', 'EXTRACTING', 'REVIEW_REQUIRED', 'ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ExtractionStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETE', 'FAILED');

-- CreateEnum
CREATE TYPE "FieldAdmissibility" AS ENUM ('COMPULSORY', 'CONDITIONAL', 'OPTIONAL');

-- CreateEnum
CREATE TYPE "DataDomain" AS ENUM ('ENERGY', 'MATERIALS', 'PRODUCTION', 'LOGISTICS', 'EMISSIONS', 'AGRICULTURE', 'WASTE_AND_WATER', 'COMPLIANCE');

-- CreateEnum
CREATE TYPE "TrustTier" AS ENUM ('A', 'B', 'C');

-- CreateEnum
CREATE TYPE "ExtractionMethod" AS ENUM ('DOCUMENT_AI', 'MANUAL_ENTRY', 'SYSTEM_INTEGRATION', 'DEFAULT_FACTOR');

-- CreateEnum
CREATE TYPE "FlagType" AS ENUM ('ENTITY_MISMATCH', 'DATE_INVALID', 'UNIT_INCONSISTENCY', 'COMPLETENESS_GAP', 'INTERNAL_INCONSISTENCY', 'LOW_CONFIDENCE', 'DUPLICATE', 'CROSS_DOC_DISCREPANCY', 'GENERIC_VALUE', 'CODE_INSUFFICIENT', 'EXPIRED_CERTIFICATE', 'DOUBLE_COUNTING', 'MISSING_CONDITIONAL_FIELD');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('PENDING', 'SUBMITTED', 'ACCEPTED', 'QUERY_RAISED', 'CLOSED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('DATA_REQUEST_RECEIVED', 'DATA_REQUEST_RESPONDED', 'EXTRACTION_COMPLETE', 'FLAG_RAISED', 'TIER_UPGRADED', 'ACCESS_GRANTED', 'ACCESS_REVOKED');

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "Entity" (
    "id" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "registrationNumber" TEXT,
    "country" TEXT NOT NULL,
    "sector" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Entity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'CONTRIBUTOR',
    "entityId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "documentType" "DocumentType" NOT NULL,
    "blobUrl" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedById" TEXT NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'PENDING',

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtractionJob" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "status" "ExtractionStatus" NOT NULL DEFAULT 'QUEUED',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "rawOutput" JSONB,

    CONSTRAINT "ExtractionJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtractedField" (
    "id" TEXT NOT NULL,
    "extractionJobId" TEXT NOT NULL,
    "fieldName" TEXT NOT NULL,
    "admissibility" "FieldAdmissibility" NOT NULL,
    "rawValue" TEXT,
    "rawUnit" TEXT,
    "normalisedValue" DOUBLE PRECISION,
    "normalisedUnit" TEXT,
    "sourceText" TEXT NOT NULL,
    "confidenceScore" DOUBLE PRECISION NOT NULL,
    "flagged" BOOLEAN NOT NULL DEFAULT false,
    "flagReason" TEXT,
    "confirmedBy" TEXT,
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "ExtractedField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataRecord" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "documentId" TEXT,
    "domain" "DataDomain" NOT NULL,
    "scope3Category" INTEGER,
    "fieldName" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL,
    "originalValue" DOUBLE PRECISION,
    "originalUnit" TEXT,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "sourceText" TEXT,
    "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "trustTier" "TrustTier" NOT NULL,
    "extractionMethod" "ExtractionMethod" NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedById" TEXT NOT NULL,
    "supersededById" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "auditHash" TEXT NOT NULL,

    CONSTRAINT "DataRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ValidationFlag" (
    "id" TEXT NOT NULL,
    "dataRecordId" TEXT NOT NULL,
    "flagType" "FlagType" NOT NULL,
    "message" TEXT NOT NULL,
    "severity" "Severity" NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "resolvedNote" TEXT,

    CONSTRAINT "ValidationFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEntry" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "hash" TEXT NOT NULL,
    "previousHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataRequest" (
    "id" TEXT NOT NULL,
    "buyerEntityId" TEXT NOT NULL,
    "supplierEntityId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "domain" "DataDomain" NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "requiredFields" JSONB NOT NULL,
    "deadline" TIMESTAMP(3),
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),
    "notes" TEXT,

    CONSTRAINT "DataRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataAccessGrant" (
    "id" TEXT NOT NULL,
    "grantorEntityId" TEXT NOT NULL,
    "granteeEntityId" TEXT NOT NULL,
    "domain" "DataDomain",
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "DataAccessGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "payload" JSONB NOT NULL,
    "sentAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmissionFactor" (
    "id" TEXT NOT NULL,
    "entityId" TEXT,
    "activityType" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "factor" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL,
    "citation" TEXT NOT NULL,
    "isDerived" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmissionFactor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrossValidationResult" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "documentAId" TEXT NOT NULL,
    "documentBId" TEXT NOT NULL,
    "fieldName" TEXT NOT NULL,
    "valueA" DOUBLE PRECISION NOT NULL,
    "valueB" DOUBLE PRECISION NOT NULL,
    "tolerancePercent" DOUBLE PRECISION NOT NULL,
    "discrepancyPercent" DOUBLE PRECISION NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "resolvedNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrossValidationResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "lastUsed" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractionJob" ADD CONSTRAINT "ExtractionJob_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractedField" ADD CONSTRAINT "ExtractedField_extractionJobId_fkey" FOREIGN KEY ("extractionJobId") REFERENCES "ExtractionJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataRecord" ADD CONSTRAINT "DataRecord_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataRecord" ADD CONSTRAINT "DataRecord_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataRecord" ADD CONSTRAINT "DataRecord_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ValidationFlag" ADD CONSTRAINT "ValidationFlag_dataRecordId_fkey" FOREIGN KEY ("dataRecordId") REFERENCES "DataRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEntry" ADD CONSTRAINT "AuditEntry_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataRequest" ADD CONSTRAINT "DataRequest_buyerEntityId_fkey" FOREIGN KEY ("buyerEntityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataRequest" ADD CONSTRAINT "DataRequest_supplierEntityId_fkey" FOREIGN KEY ("supplierEntityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataRequest" ADD CONSTRAINT "DataRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataAccessGrant" ADD CONSTRAINT "DataAccessGrant_grantorEntityId_fkey" FOREIGN KEY ("grantorEntityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataAccessGrant" ADD CONSTRAINT "DataAccessGrant_granteeEntityId_fkey" FOREIGN KEY ("granteeEntityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmissionFactor" ADD CONSTRAINT "EmissionFactor_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
