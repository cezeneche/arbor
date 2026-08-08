# Deploying Arbor

## Migrations are not part of the build

`npm run build` runs `next build` and nothing else.

It used to run `prisma migrate deploy` first. That coupled two things that fail
differently and recover differently:

- A **build** is repeatable and disposable. It can be retried, cancelled, or run
  twice with no consequence.
- A **migration** mutates the production database once and, for anything that
  drops a column or a table, cannot be undone by re-running an older build.

With them fused, a rollback to the previous deployment left the schema at the new
version, a preview build could not be produced without a migration attempt, and
two concurrent builds could race the same migration. The most recent
schema-reconciliation migration drops a table and a column — exactly the shape of
change that must be a deliberate step, not a side effect of pressing "deploy".

## The order to deploy in

1. **Apply the migration**, against the production database, from a machine or job
   with `DATABASE_URL` set:

   ```sh
   npm run migrate:deploy
   ```

2. **Deploy the application** once the migration has succeeded.

Migrations in this repository are written to be safe in that order: new columns
are nullable or defaulted, new tables are additive, and new indexes use
`IF NOT EXISTS`. The running (old) application therefore keeps working between
step 1 and step 2.

## Rolling back

Roll back the application deployment on its own. Do not roll a migration back by
deploying an older build — an older build no longer knows how to reverse a schema
change, and for a destructive migration nothing does. A schema change that has to
be undone is undone by a new forward migration.

## Backfills

Any migration that rewrites existing rows says so in its header comment, and
explains what it does with rows it cannot place. Read that comment before
applying it to production.
