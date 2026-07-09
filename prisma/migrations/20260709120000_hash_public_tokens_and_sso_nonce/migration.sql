-- Public tokens are now stored as SHA-256 hashes, not plaintext. Existing rows
-- hold plaintext that cannot be matched under hash lookup, so they are cleared
-- (links reissued). Safe at this stage; avoids leaving plaintext at rest.

-- SharedExport: token -> tokenHash. Existing shares are dropped (reissue links).
DELETE FROM "SharedExport";
ALTER TABLE "SharedExport" RENAME COLUMN "token" TO "tokenHash";
ALTER INDEX "SharedExport_token_key" RENAME TO "SharedExport_tokenHash_key";

-- DataRequest submission link: submissionToken -> submissionTokenHash. Requests
-- are kept; any live submission link is invalidated (reissue via the request).
UPDATE "DataRequest" SET "submissionToken" = NULL, "submissionTokenExpiry" = NULL WHERE "submissionToken" IS NOT NULL;
ALTER TABLE "DataRequest" RENAME COLUMN "submissionToken" TO "submissionTokenHash";
ALTER INDEX "DataRequest_submissionToken_key" RENAME TO "DataRequest_submissionTokenHash_key";

-- Single-use SSO bridge nonce.
ALTER TABLE "User" ADD COLUMN "ssoNonceHash" TEXT;
ALTER TABLE "User" ADD COLUMN "ssoNonceExpires" TIMESTAMP(3);
