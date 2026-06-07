-- Add operational indexes to hot tables.
-- These indexes cover the most common query patterns: filtering by entityId + status/domain/tier,
-- and foreign-key lookups on documentId and recordId.

-- Document
CREATE INDEX "Document_entityId_status_idx" ON "Document"("entityId", "status");
CREATE INDEX "Document_entityId_submittedAt_idx" ON "Document"("entityId", "submittedAt");

-- DataRecord
CREATE INDEX "DataRecord_entityId_isActive_idx" ON "DataRecord"("entityId", "isActive");
CREATE INDEX "DataRecord_entityId_domain_isActive_idx" ON "DataRecord"("entityId", "domain", "isActive");
CREATE INDEX "DataRecord_entityId_trustTier_isActive_idx" ON "DataRecord"("entityId", "trustTier", "isActive");
CREATE INDEX "DataRecord_entityId_submittedAt_idx" ON "DataRecord"("entityId", "submittedAt");
CREATE INDEX "DataRecord_documentId_idx" ON "DataRecord"("documentId");

-- AuditEntry
CREATE INDEX "AuditEntry_entityId_createdAt_idx" ON "AuditEntry"("entityId", "createdAt");
CREATE INDEX "AuditEntry_recordId_idx" ON "AuditEntry"("recordId");

-- DataRequest
CREATE INDEX "DataRequest_buyerEntityId_status_idx" ON "DataRequest"("buyerEntityId", "status");
CREATE INDEX "DataRequest_supplierEntityId_status_idx" ON "DataRequest"("supplierEntityId", "status");
CREATE INDEX "DataRequest_createdAt_idx" ON "DataRequest"("createdAt");

-- DataAccessGrant
CREATE INDEX "DataAccessGrant_granteeEntityId_isActive_idx" ON "DataAccessGrant"("granteeEntityId", "isActive");
CREATE INDEX "DataAccessGrant_grantorEntityId_isActive_idx" ON "DataAccessGrant"("grantorEntityId", "isActive");

-- ApiKey
CREATE INDEX "ApiKey_entityId_isActive_idx" ON "ApiKey"("entityId", "isActive");
