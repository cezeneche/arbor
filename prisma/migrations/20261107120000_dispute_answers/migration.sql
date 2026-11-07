-- A buyer who disputes a supplier's value is told how the supplier answered.
-- Additive: one nullable column and one enum value.

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'BUYER_DISPUTE_ANSWERED';

-- AlterTable
ALTER TABLE "ValidationFlag" ADD COLUMN "raisedByEntityId" TEXT;
