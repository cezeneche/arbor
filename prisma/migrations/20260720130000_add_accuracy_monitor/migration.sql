-- MLOps guardrail: accuracy & drift monitor. Each drift cron records one
-- AccuracyRun + a per-group metric row (recent correct-rate vs baseline, and the
-- confidence-distribution PSI between the windows) so extraction-accuracy
-- degradation is tracked over time and made alertable. Additive; derived
-- measurement only — never part of the audit chain.

CREATE TABLE "AccuracyRun" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "labelCount" INTEGER NOT NULL,
    "recentWindow" INTEGER NOT NULL,
    "minSamples" INTEGER NOT NULL,
    "degraded" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "AccuracyRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AccuracyGroupMetric" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "recentN" INTEGER NOT NULL,
    "baselineN" INTEGER NOT NULL,
    "recentAccuracy" DOUBLE PRECISION,
    "baselineAccuracy" DOUBLE PRECISION,
    "accuracyDelta" DOUBLE PRECISION,
    "confidencePsi" DOUBLE PRECISION,
    "sufficient" BOOLEAN NOT NULL,
    "isKillSignalGroup" BOOLEAN NOT NULL,
    "accuracyDegraded" BOOLEAN NOT NULL,
    "confidenceDrift" BOOLEAN NOT NULL,

    CONSTRAINT "AccuracyGroupMetric_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AccuracyRun_createdAt_idx" ON "AccuracyRun"("createdAt");
CREATE INDEX "AccuracyGroupMetric_runId_idx" ON "AccuracyGroupMetric"("runId");
CREATE INDEX "AccuracyGroupMetric_group_id_idx" ON "AccuracyGroupMetric"("group", "id");

ALTER TABLE "AccuracyGroupMetric" ADD CONSTRAINT "AccuracyGroupMetric_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AccuracyRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
