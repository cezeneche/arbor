"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { createCbamCase } from "@/lib/api";

const CURRENT_YEAR = new Date().getFullYear();

const fieldStyle: React.CSSProperties = {
  width: "100%",
  height: "var(--touch-min)",
  padding: "0 var(--space-4)",
  borderRadius: "var(--radius-md)",
  border: "1px solid var(--color-border)",
  backgroundColor: "var(--color-surface-raised)",
  color: "var(--color-text-primary)",
  fontSize: "var(--text-sm)",
  fontFamily: "var(--font-sans)",
  boxSizing: "border-box" as const,
  outline: "none",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "var(--text-xs)",
  fontWeight: "var(--font-weight-semibold)",
  color: "var(--color-text-secondary)",
  marginBottom: "var(--space-2)",
  textTransform: "uppercase",
  letterSpacing: "var(--tracking-wide)",
};

const cardStyle: React.CSSProperties = {
  backgroundColor: "var(--color-surface)",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-xl)",
  padding: "var(--space-6)",
};

export default function NewCasePage() {
  const router = useRouter();
  const [eori, setEori]       = useState("");
  const [name, setName]       = useState("");
  const [year, setYear]       = useState(String(CURRENT_YEAR));
  const [quarter, setQuarter] = useState<"1"|"2"|"3"|"4">("1");
  const [toast, setToast]     = useState<{ type: "error"; msg: string } | null>(null);

  const { mutate, isPending } = useMutation({
    mutationFn: () =>
      createCbamCase({
        importer_eori:     eori,
        importer_name:     name || undefined,
        reporting_year:    Number(year),
        reporting_quarter: Number(quarter) as 1 | 2 | 3 | 4,
      }),
    onSuccess: (c) => router.push(`/cases/${c.id}`),
    onError:   (err) => setToast({ type: "error", msg: (err as Error).message }),
  });

  return (
    <div style={{ maxWidth: "560px", display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>

      {/* Back link */}
      <Link href="/cases" style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-2)", fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", textDecoration: "none" }}>
        ← Back to cases
      </Link>

      {/* Page heading */}
      <div>
        <h1 style={{ margin: 0, fontSize: "var(--text-2xl)", fontWeight: "var(--font-weight-semibold)", color: "var(--color-text-primary)" }}>
          New CBAM Case
        </h1>
        <p style={{ margin: "var(--space-1) 0 0", fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>
          Create a new CBAM reporting case
        </p>
      </div>

      {/* Error toast */}
      {toast && (
        <div role="alert" style={{ padding: "var(--space-4)", borderRadius: "var(--radius-lg)", backgroundColor: "var(--color-error-bg)", border: "1px solid var(--color-error-border)", color: "var(--color-error-text)", fontSize: "var(--text-sm)" }}>
          {toast.msg}
        </div>
      )}

      {/* Importer details */}
      <div style={cardStyle}>
        <p style={{ margin: "0 0 var(--space-4)", fontSize: "var(--text-base)", fontWeight: "var(--font-weight-semibold)", color: "var(--color-text-primary)" }}>
          Importer details
        </p>
        <p style={{ margin: "0 0 var(--space-5)", fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>
          The EU importer responsible for this CBAM declaration.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
          <div>
            <label htmlFor="eori" style={labelStyle}>EORI Number *</label>
            <input
              id="eori"
              type="text"
              value={eori}
              onChange={(e) => setEori(e.target.value)}
              placeholder="GB123456789000"
              required
              style={{ ...fieldStyle, fontFamily: "var(--font-mono)" }}
            />
            <p style={{ margin: "var(--space-1) 0 0", fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>
              EU Economic Operators Registration and Identification number
            </p>
          </div>
          <div>
            <label htmlFor="company-name" style={labelStyle}>Company name <span style={{ fontWeight: "var(--font-weight-regular)", textTransform: "none", letterSpacing: 0 }}>(optional)</span></label>
            <input
              id="company-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Acme Steel GmbH"
              style={fieldStyle}
            />
          </div>
        </div>
      </div>

      {/* Reporting period */}
      <div style={cardStyle}>
        <p style={{ margin: "0 0 var(--space-4)", fontSize: "var(--text-base)", fontWeight: "var(--font-weight-semibold)", color: "var(--color-text-primary)" }}>
          Reporting period
        </p>
        <p style={{ margin: "0 0 var(--space-5)", fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>
          CBAM declarations are submitted quarterly.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-4)" }}>
          <div>
            <label htmlFor="year" style={labelStyle}>Year</label>
            <input
              id="year"
              type="number"
              value={year}
              onChange={(e) => setYear(e.target.value)}
              min={2024}
              max={2100}
              style={fieldStyle}
            />
          </div>
          <div>
            <label htmlFor="quarter" style={labelStyle}>Quarter</label>
            <select
              id="quarter"
              value={quarter}
              onChange={(e) => setQuarter(e.target.value as "1"|"2"|"3"|"4")}
              style={{ ...fieldStyle, cursor: "pointer" }}
            >
              <option value="1">Q1</option>
              <option value="2">Q2</option>
              <option value="3">Q3</option>
              <option value="4">Q4</option>
            </select>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: "var(--space-3)" }}>
        <button
          type="button"
          onClick={() => mutate()}
          disabled={isPending || !eori}
          style={{
            height: "var(--touch-min)",
            padding: "0 var(--space-6)",
            borderRadius: "var(--radius-btn)",
            border: "none",
            backgroundColor: isPending || !eori ? "var(--color-border)" : "var(--color-accent)",
            color: isPending || !eori ? "var(--color-text-muted)" : "var(--color-text-on-accent)",
            fontSize: "var(--text-sm)",
            fontWeight: "var(--font-weight-semibold)",
            cursor: isPending || !eori ? "not-allowed" : "pointer",
          }}
        >
          {isPending ? "Creating…" : "Create Case"}
        </button>
        <Link
          href="/cases"
          style={{
            display: "inline-flex",
            alignItems: "center",
            height: "var(--touch-min)",
            padding: "0 var(--space-5)",
            borderRadius: "var(--radius-btn)",
            border: "1px solid var(--color-border)",
            backgroundColor: "transparent",
            color: "var(--color-text-secondary)",
            fontSize: "var(--text-sm)",
            textDecoration: "none",
          }}
        >
          Cancel
        </Link>
      </div>
    </div>
  );
}
