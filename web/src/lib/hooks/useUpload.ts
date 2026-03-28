"use client";

/**
 * lib/hooks/useUpload.ts — single-call upload state machine
 *
 * Sends the file to POST /api/cbam/drafts/from-document which handles
 * extraction, arbitration, repair, and CBAM draft creation in one request.
 *
 * Steps:
 *   uploading   — file bytes being transferred (progress 0–100)
 *   processing  — bytes sent, server extracting and creating draft
 *   done        — result available
 *   error       — something went wrong
 *
 * Returns: { step, progress, result, error, upload(file), reset }
 */

import { useCallback, useRef, useState } from "react";
import { createDraftFromDocument } from "@/lib/api/documents";
import type { DraftResult } from "@/lib/api/types";

/* ── Step type ────────────────────────────────────────────────────────────────── */

export type UploadStep =
  | "idle"
  | "uploading"
  | "processing"
  | "done"
  | "error";

/* ── Return type ──────────────────────────────────────────────────────────────── */

export interface UseUploadReturn {
  step:     UploadStep;
  /** 0–100 during "uploading", 100 once upload bytes are sent */
  progress: number;
  result:   DraftResult | undefined;
  error:    Error | null;
  /** Start the upload. Returns the draft result, or null on error. */
  upload:   (file: File) => Promise<DraftResult | null>;
  reset:    () => void;
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

  const upload = useCallback(async (file: File): Promise<DraftResult | null> => {
    abortRef.current = false;
    setStep("uploading");
    setProgress(0);
    setResult(undefined);
    setError(null);

    try {
      const draft = await createDraftFromDocument(file, (pct) => {
        setProgress(pct);
        // Once bytes are fully sent, server processing begins
        if (pct >= 100) setStep("processing");
      });

      if (abortRef.current) return null;

      setResult(draft);
      setStep("done");
      return draft;
    } catch (err) {
      if (!abortRef.current) {
        setError(
          err instanceof Error ? err : new Error("An unexpected error occurred.")
        );
        setStep("error");
      }
      return null;
    }
  }, []);

  return { step, progress, result, error, upload, reset };
}
