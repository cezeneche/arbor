-- Buyer-side learning signal: a buyer with an active data-access grant can
-- confirm or dispute a shared record. Captured as ground truth (buyer-sourced),
-- with a dispute also raising a flag on the record and notifying the supplier.
-- Additive enum values only — nothing changes for existing rows, and the
-- certified record is never mutated.

ALTER TYPE "GroundTruthSource" ADD VALUE 'BUYER_CONFIRMED';
ALTER TYPE "GroundTruthSource" ADD VALUE 'BUYER_DISPUTED';

ALTER TYPE "FlagType" ADD VALUE 'BUYER_DISPUTED';

ALTER TYPE "NotificationType" ADD VALUE 'BUYER_DISPUTE_RAISED';
