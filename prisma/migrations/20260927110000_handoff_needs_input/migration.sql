-- A handoff that cannot open a case until the user supplies an identifier.
-- On its own: a new enum value cannot be used in the transaction that adds it.
-- AlterEnum
ALTER TYPE "CbamHandoffStatus" ADD VALUE IF NOT EXISTS 'NEEDS_INPUT';
