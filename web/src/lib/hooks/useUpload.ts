"use client";

/**
 * lib/hooks/useUpload.ts — 3-step upload state machine
 *
 * Step 1 — uploading    (XHR with progress 0–100)
 * Step 2 — extracting   (polls extractDocument every 2 s until complete/failed)
 * Step 3 — creating     (createDraftFromDocument → DraftResult)
 *
 * Returns: { step, progress, result, error, upload(file, caseId?), reset }
 *
 * caseId is required for upload (backend route is /cases/{caseId}/documents/upload).
 * createDraftFromDocument in step 3 uses the same caseId to build the CBAM structure.
 */

import { useCallback, useRef, useState } from "react";
import {
  uploadDocument,
  extractDocument,
  createDraftFromDocument,
} from "@/lib/api/documents";
import type { DraftResult, ExtractionResult } from "@/lib/api/types";

/* ── Step type ────────────────────────────────────────────────────────────────── */

export type UploadStep =
  | "idle"
  | "uploading"
  | "extracting"
  | "creating"
  | "done"
  | "error";

/* ── Return type ──────────────────────────────────────────────────────────────── */

export interface UseUploadReturn {
  step:     UploadStep;
  /** 0–100 during "uploading", 100 once upload is complete */
  progress: number;
  result:   DraftResult | undefined;
  error:    Error | null;
  /** Start the 3-step pipeline. */
  upload:   (file: File, caseId: string) => Promise<void>;
  reset:    () => void;
}

/* ── Poll helper ──────────────────────────────────────────────────────────────── */

const POLL_INTERVAL_MS = 2_000;
const MAX_POLLS        = 30;   // 60 s hard timeout

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function pollExtraction(
  caseId:     string,
  documentId: string,
  abortRef:   React.MutableRefObject<boolean>
): Promise<ExtractionResult> {
  for (let i = 0; i < MAX_POLLS; i++) {
    if (abortRef.current) throw new Error("Upload cancelled.");
    const res = await extractDocument(caseId, documentId);
    if (res.status === "complete" || res.status === "failed") return res;
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error("Extraction timed out. Please try again.");
}

/* ── Hook ─────────────────────────────────────────────────────────────────────── */

export function useUpload(): UseUploadReturn {
  const [step,     setStep]     = useState<UploadStep>("idle");
  const [progress, setProgress] = useState(0);
  const [result,   setResult]   = useState<DraftResult | undefined>(undefined);
  const [error,    setError]    = useState<Error | null>(null);

  const abortRef = useRef(false);

  const reset = useCallback(() => {
    abortRef.current = true;
    setStep("idle");
    setProgress(0);
    setResult(undefined);
    setError(null);
    setTimeout(() => { abortRef.current = false; }, 0);
  }, []);

  const upload = useCallback(async (file: File, caseId: string) => {
    abortRef.current = false;
    setStep("uploading");
    setProgress(0);
    setResult(undefined);
    setError(null);

    try {
      /* ── Step 1: upload ──────────────────────────────────────────────────────── */
      const uploadRes = await uploadDocument(file, caseId, (pct) => {
        setProgress(pct);
      });
      setProgress(100);

      if (abortRef.current) return;

      /* ── Step 2: extract ─────────────────────────────────────────────────────── */
      setStep("extracting");

      const extractRes = await pollExtraction(
        uploadRes.case_id,
        uploadRes.document_id,
        abortRef
      );

      if (abortRef.current) return;

      if (extractRes.status === "failed") {
        throw new Error(
          "Document extraction failed. Please check the file format and try again."
        );
      }

      /* ── Step 3: create draft ────────────────────────────────────────────────── */
      setStep("creating");

      const draft = await createDraftFromDocument(
        uploadRes.document_id,
        uploadRes.case_id
      );

      if (abortRef.current) return;

      setResult(draft);
      setStep("done");
    } catch (err) {
      if (!abortRef.current) {
        setError(
          err instanceof Error ? err : new Error("An unexpected error occurred.")
        );
        setStep("error");
      }
    }
  }, []);

  return { step, progress, result, error, upload, reset };
}
