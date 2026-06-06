-- CreateTable: InstitutionalEnquiry
CREATE TABLE "InstitutionalEnquiry" (
    "id"           TEXT NOT NULL,
    "orgName"      TEXT NOT NULL,
    "contactName"  TEXT NOT NULL,
    "email"        TEXT NOT NULL,
    "role"         TEXT,
    "interestArea" TEXT NOT NULL,
    "message"      TEXT,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InstitutionalEnquiry_pkey" PRIMARY KEY ("id")
);
