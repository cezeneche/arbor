-- Extraction SLO: share of documents uploaded in the last 30 days whose
-- extraction completed within 5 minutes of upload. Read only.
SELECT
  count(*) AS documents,
  count(*) FILTER (
    WHERE j.status = 'COMPLETE' AND j."completedAt" - d."submittedAt" <= interval '5 minutes'
  ) AS within_5_minutes,
  round(100.0 * count(*) FILTER (
    WHERE j.status = 'COMPLETE' AND j."completedAt" - d."submittedAt" <= interval '5 minutes'
  ) / nullif(count(*), 0), 2) AS percent
FROM "Document" d
LEFT JOIN LATERAL (
  SELECT status, "completedAt" FROM "ExtractionJob"
  WHERE "documentId" = d.id
  ORDER BY "completedAt" ASC NULLS LAST
  LIMIT 1
) j ON true
WHERE d."submittedAt" >= now() - interval '30 days'
  AND d."submittedAt" < now() - interval '5 minutes';
