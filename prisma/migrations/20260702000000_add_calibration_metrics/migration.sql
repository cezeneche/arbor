-- Upgrade 1 (measurement loop). Additive only: calibration metric tracking.
-- Each offline calibration fit records one CalibrationRun with a per-group metric
-- row, so the headline ECE/Brier are tracked over time and the kill signal
-- (ECE < 5% for supplier identity, mass, emissions intensity) is monitored.
-- Derived measurement — never touches DataRecord or the HMAC audit chain.

-- CreateTable
CREATE TABLE "CalibrationRun" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "labelCount" INTEGER NOT NULL,
    "minSamples" INTEGER NOT NULL,
    "brainFittedAt" TIMESTAMP(3) NOT NULL,
    "killSignalBreached" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "CalibrationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalibrationGroupMetric" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "n" INTEGER NOT NULL,
    "brier" DOUBLE PRECISION,
    "ece" DOUBLE PRECISION,
    "sufficient" BOOLEAN NOT NULL,
    "isKillSignalGroup" BOOLEAN NOT NULL,
    "breached" BOOLEAN NOT NULL,

    CONSTRAINT "CalibrationGroupMetric_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CalibrationRun_createdAt_idx" ON "CalibrationRun"("createdAt");

-- CreateIndex
CREATE INDEX "CalibrationGroupMetric_runId_idx" ON "CalibrationGroupMetric"("runId");

-- CreateIndex
CREATE INDEX "CalibrationGroupMetric_group_id_idx" ON "CalibrationGroupMetric"("group", "id");

-- AddForeignKey
ALTER TABLE "CalibrationGroupMetric" ADD CONSTRAINT "CalibrationGroupMetric_runId_fkey" FOREIGN KEY ("runId") REFERENCES "CalibrationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
