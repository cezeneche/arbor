-- Give every audit entry an explicit position in its entity's chain.
--
-- The chain was ordered by "createdAt" alone. Postgres stamps every statement in
-- a transaction with the same now(), so entries written together tie: the "tail"
-- lookup that supplies previousHash could pick either, and verification could walk
-- them in either order. Both are silent correctness failures in the one structure
-- whose whole job is to be tamper-evident.
--
-- Backfill runs in two passes so existing chains keep the order they were actually
-- written in:
--   1. follow previousHash from each entity's genesis entry (the real link order);
--   2. anything unreachable from a genesis — a chain already broken before this
--      migration — falls back to (createdAt, id), appended after the reachable part.
-- The payload is untouched and "sequence" is not part of the hashed material, so no
-- existing hash changes and nothing is re-hashed.

ALTER TABLE "AuditEntry" ADD COLUMN IF NOT EXISTS "sequence" INTEGER;

WITH RECURSIVE linked AS (
  SELECT e."id", e."entityId", e."hash", 1 AS seq
  FROM "AuditEntry" e
  WHERE e."previousHash" IS NULL

  UNION ALL

  SELECT n."id", n."entityId", n."hash", l.seq + 1
  FROM "AuditEntry" n
  JOIN linked l
    ON n."previousHash" = l."hash"
   AND n."entityId" = l."entityId"
)
UPDATE "AuditEntry" a
SET "sequence" = linked.seq
FROM linked
WHERE a."id" = linked."id";

WITH orphaned AS (
  SELECT
    a."id",
    a."entityId",
    ROW_NUMBER() OVER (PARTITION BY a."entityId" ORDER BY a."createdAt", a."id") AS rn
  FROM "AuditEntry" a
  WHERE a."sequence" IS NULL
),
offsets AS (
  SELECT "entityId", COALESCE(MAX("sequence"), 0) AS base
  FROM "AuditEntry"
  GROUP BY "entityId"
)
UPDATE "AuditEntry" a
SET "sequence" = offsets.base + orphaned.rn
FROM orphaned
JOIN offsets ON offsets."entityId" = orphaned."entityId"
WHERE a."id" = orphaned."id";

-- Any row still null has no entity partition at all; nothing sensible to order it
-- against, so it takes position 1.
UPDATE "AuditEntry" SET "sequence" = 1 WHERE "sequence" IS NULL;

ALTER TABLE "AuditEntry" ALTER COLUMN "sequence" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "AuditEntry_entityId_sequence_key"
  ON "AuditEntry"("entityId", "sequence");
