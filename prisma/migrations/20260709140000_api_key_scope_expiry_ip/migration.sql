-- API key hardening: read/write scope, optional expiry, optional IP allowlist.
-- Existing keys default to READ_WRITE with no expiry / no IP restriction so no
-- integration breaks; new keys can be minted with tighter scope.
CREATE TYPE "ApiKeyScope" AS ENUM ('READ', 'READ_WRITE');

ALTER TABLE "ApiKey" ADD COLUMN "scope" "ApiKeyScope" NOT NULL DEFAULT 'READ_WRITE';
ALTER TABLE "ApiKey" ADD COLUMN "expiresAt" TIMESTAMP(3);
ALTER TABLE "ApiKey" ADD COLUMN "ipAllowlist" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
