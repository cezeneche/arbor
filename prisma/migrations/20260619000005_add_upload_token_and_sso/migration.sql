-- Gap 8.4 — email-to-upload token. Gap 10 — SSO org binding + user active flag.
-- AlterTable
ALTER TABLE "Entity" ADD COLUMN     "uploadEmailToken" TEXT,
ADD COLUMN     "workosOrganisationId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE UNIQUE INDEX "Entity_uploadEmailToken_key" ON "Entity"("uploadEmailToken");
CREATE UNIQUE INDEX "Entity_workosOrganisationId_key" ON "Entity"("workosOrganisationId");
