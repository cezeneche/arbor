-- AlterTable
ALTER TABLE "User" ADD COLUMN     "twoFactorVerifiedNonce" TEXT,
ADD COLUMN     "twoFactorVerifiedExpires" TIMESTAMP(3);
