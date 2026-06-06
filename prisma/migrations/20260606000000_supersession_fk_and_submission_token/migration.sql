-- Add self-referential FK for DataRecord supersession
ALTER TABLE "DataRecord" ADD CONSTRAINT "DataRecord_supersededById_fkey"
  FOREIGN KEY ("supersededById") REFERENCES "DataRecord"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Add submission token fields to DataRequest
ALTER TABLE "DataRequest"
  ADD COLUMN "submissionToken" TEXT,
  ADD COLUMN "submissionTokenExpiry" TIMESTAMP(3);

CREATE UNIQUE INDEX "DataRequest_submissionToken_key" ON "DataRequest"("submissionToken");
