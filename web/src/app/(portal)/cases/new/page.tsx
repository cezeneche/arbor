"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ledgerFetch } from "@/lib/api/client";
import { useUpload } from "@/lib/hooks/useUpload";

function ProgressBar({ value }: { value: number }) {
  return (
    <div
      style={{
        height:          "4px",
        backgroundColor: "var(--color-border)",
        borderRadius:    "2px",
        overflow:        "hidden",
      }}
    >
      <div
        style={{
          height:          "100%",
          width:           `${value}%`,
          backgroundColor: "var(--color-navy)",
          transition:      "width var(--transition-normal)",
          borderRadius:    "2px",
        }}
      />
    </div>
  );
}

export default function NewCasePage() {
  const router  = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file,  setFile]  = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const { step, progress, result, error, upload } = useUpload();

  const isProcessing = step === "uploading" || step === "extracting" || step === "creating";

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) setFile(f);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) setFile(f);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;

    // Create a case first, then upload the document to it
    try {
      const newCase = await ledgerFetch<{ case_id: string; id: string }>(
        "/api/cbam/cases",
        {
          method: "POST",
          body:   JSON.stringify({
            importer_eori:      "PENDING",
            reporting_year:     new Date().getFullYear(),
            reporting_quarter:  Math.ceil((new Date().getMonth() + 1) / 3),
          }),
        }
      );
      const caseId = newCase.case_id ?? newCase.id;
      await upload(file, caseId);
    } catch (err) {
      console.error(err);
    }
  }

  // Redirect when done
  if (step === "done" && result) {
    router.replace(`/cases/${result.case_id}`);
    return null;
  }

  const stepLabel: Record<string, string> = {
    uploading:  `Uploading… ${progress}%`,
    extracting: "Extracting data from document…",
    creating:   "Creating case…",
  };

  return (
    <div className="page-content">
      <h1
        style={{
          fontSize:     "var(--text-lg)",
          fontWeight:   "var(--font-focal)",
          color:        "var(--color-text-primary)",
          marginBottom: "var(--space-8)",
        }}
      >
        Upload document
      </h1>
      <p
        style={{
          fontSize:     "var(--text-sm)",
          color:        "var(--color-text-secondary)",
          marginBottom: "var(--space-48)",
        }}
      >
        Upload a supplier invoice, mill certificate, or customs declaration.
        Nucleos will extract CBAM data automatically.
      </p>

      <form onSubmit={handleSubmit} style={{ maxWidth: "560px" }}>
        {/* Drop zone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileRef.current?.click()}
          style={{
            border:          `var(--border-width) solid ${dragging ? "var(--color-navy)" : "var(--color-border)"}`,
            borderRadius:    "var(--card-radius)",
            padding:         "var(--space-48) var(--space-32)",
            textAlign:       "center",
            cursor:          "pointer",
            backgroundColor: dragging ? "rgba(27,53,87,0.03)" : "var(--color-surface)",
            transition:      "border-color var(--transition-fast), background-color var(--transition-fast)",
            marginBottom:    "var(--space-24)",
          }}
        >
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.csv,.xml,.xlsx,.txt"
            onChange={handleFileChange}
            style={{ display: "none" }}
          />

          {file ? (
            <>
              <p style={{ fontSize: "var(--text-base)", color: "var(--color-text-primary)" }}>
                {file.name}
              </p>
              <p
                style={{
                  fontSize:  "var(--text-xs)",
                  color:     "var(--color-text-tertiary)",
                  marginTop: "var(--space-8)",
                }}
              >
                {(file.size / 1024).toFixed(0)} KB — click to change
              </p>
            </>
          ) : (
            <>
              <p style={{ fontSize: "var(--text-base)", color: "var(--color-text-secondary)" }}>
                Drop a file here, or click to select
              </p>
              <p
                style={{
                  fontSize:  "var(--text-xs)",
                  color:     "var(--color-text-tertiary)",
                  marginTop: "var(--space-8)",
                }}
              >
                PDF, CSV, XML, XLSX, TXT
              </p>
            </>
          )}
        </div>

        {/* Processing status */}
        {isProcessing && (
          <div style={{ marginBottom: "var(--space-24)" }}>
            <p
              style={{
                fontSize:     "var(--text-sm)",
                color:        "var(--color-text-secondary)",
                marginBottom: "var(--space-8)",
              }}
            >
              {stepLabel[step]}
            </p>
            <ProgressBar value={step === "uploading" ? progress : 100} />
          </div>
        )}

        {/* Error */}
        {error && (
          <p
            style={{
              fontSize:     "var(--text-sm)",
              color:        "var(--color-red)",
              marginBottom: "var(--space-24)",
            }}
          >
            {error.message}
          </p>
        )}

        <Button
          type="submit"
          variant="primary"
          disabled={!file}
          loading={isProcessing}
        >
          Process document
        </Button>
      </form>
    </div>
  );
}
