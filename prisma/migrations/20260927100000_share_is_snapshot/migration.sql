-- Empty snapshots are snapshots. An empty "recordIds" meant "issued before
-- snapshots, keep the live scope", but a share issued over a scope with no
-- records in it also froze an empty list, and was then read as live: records
-- added later appeared through a link whose integrity hash covered nothing.
--
-- New shares are snapshots. An existing share is legacy only when it froze
-- nothing AND was issued before the snapshot migration finished. If that
-- migration's row cannot be found the comparison is NULL and nothing is marked
-- legacy — an old share then shows nothing rather than a new one showing too
-- much.
-- AlterTable
ALTER TABLE "SharedExport" ADD COLUMN "isSnapshot" BOOLEAN NOT NULL DEFAULT true;

UPDATE "SharedExport"
SET "isSnapshot" = false
WHERE cardinality("recordIds") = 0
  AND "createdAt" < (
    SELECT "finished_at" FROM "_prisma_migrations"
    WHERE "migration_name" = '20260919120000_share_record_snapshot'
      AND "finished_at" IS NOT NULL
    ORDER BY "finished_at" ASC
    LIMIT 1
  );
