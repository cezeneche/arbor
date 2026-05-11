"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { deleteCase } from "@/lib/api/cases";
import { SectionLabel, Divider, MONO, fmtDate } from "./shared";
import type { CaseDetail } from "@/lib/api/types";

export function SettingsTab({ case_ }: { case_: CaseDetail }) {
  const router      = useRouter();
  const queryClient = useQueryClient();
  const initYear    = String(case_.reporting_year ?? "");
  const initQuarter = String(case_.reporting_quarter ?? "1");
  const [year,      setYear]      = useState(initYear);
  const [quarter,   setQuarter]   = useState(initQuarter);
  const [regime,    setRegime]    = useState<"UK" | "EU">("UK");
  const [savingP,   setSavingP]   = useState(false);
  const [savedP,    setSavedP]    = useState(false);
  const [confirm,   setConfirm]   = useState(false);
  const [deleting,  setDeleting]  = useState(false);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);
  const [focused,   setFocused]   = useState<string | null>(null);

  const isPeriodDirty = year !== initYear || quarter !== initQuarter;

  async function handleDelete() {
    setDeleting(true);
    setDeleteErr(null);
    try {
      await deleteCase(case_.id);
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["cases"] });
        router.refresh();
        router.push("/");
      }, 1000);
    } catch (e) {
      setDeleteErr((e as Error).message ?? "Delete failed. Please try again.");
      setDeleting(false);
    }
  }

  async function handleSavePeriod() {
    setSavingP(true);
    await new Promise(r => setTimeout(r, 350));
    // TODO: PATCH /api/cbam/cases/{case_.id} with { reporting_year, reporting_quarter, jurisdiction }
    setSavingP(false);
    setSavedP(true);
  }

  return (
    <div>
      <div style={{ marginBottom: "var(--space-40)" }}>
        <div style={{ marginBottom: "var(--space-24)" }}>
          <SectionLabel>Reporting period</SectionLabel>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "var(--space-16)", marginBottom: "var(--space-24)" }}>
          <div>
            <label style={{ fontSize: "11px", fontWeight: 300, color: "var(--color-text-secondary)", display: "block", marginBottom: "6px" }}>
              Reporting year
            </label>
            <input
              type="number"
              value={year}
              min={2027}
              onChange={e => { setYear(e.target.value); setSavedP(false); }}
              onFocus={() => setFocused("year")}
              onBlur={() => setFocused(null)}
              style={{ display: "block", width: "100%", height: "40px", padding: "0 var(--space-16)", fontSize: "var(--text-base)", fontWeight: "var(--font-body)", fontFamily: "inherit", color: "var(--color-text-primary)", backgroundColor: "var(--color-surface)", border: `0.5px solid ${focused === "year" ? "var(--color-navy)" : "var(--color-border)"}`, borderRadius: "6px", outline: "none", boxSizing: "border-box" }}
            />
          </div>

          <div>
            <label style={{ fontSize: "11px", fontWeight: 300, color: "var(--color-text-secondary)", display: "block", marginBottom: "6px" }}>
              Quarter
            </label>
            <select
              value={quarter}
              onChange={e => { setQuarter(e.target.value); setSavedP(false); }}
              style={{ display: "block", width: "100%", height: "40px", padding: "0 var(--space-16)", fontSize: "var(--text-base)", fontWeight: "var(--font-body)", fontFamily: "inherit", color: "var(--color-text-primary)", backgroundColor: "var(--color-surface)", border: "0.5px solid var(--color-border)", borderRadius: "6px", outline: "none", boxSizing: "border-box", appearance: "none", cursor: "pointer" }}
            >
              {[1, 2, 3, 4].map(q => <option key={q} value={q}>Q{q}</option>)}
            </select>
          </div>

          <div>
            <label style={{ fontSize: "11px", fontWeight: 300, color: "var(--color-text-secondary)", display: "block", marginBottom: "6px" }}>
              Regime
            </label>
            <div style={{ display: "flex", height: "40px", border: "0.5px solid var(--color-border)", borderRadius: "6px", overflow: "hidden" }}>
              {(["UK", "EU"] as const).map(r => (
                <button
                  key={r}
                  type="button"
                  onClick={() => { setRegime(r); setSavedP(false); }}
                  style={{
                    flex: 1, border: "none", outline: "none", cursor: "pointer", fontSize: "var(--text-sm)", fontWeight: regime === r ? "var(--font-focal)" : "var(--font-body)", fontFamily: "inherit",
                    backgroundColor: regime === r ? "var(--color-navy)" : "var(--color-surface)",
                    color:           regime === r ? "#ffffff" : "var(--color-text-secondary)",
                    transition:      "background-color 100ms",
                  }}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
        </div>

        {isPeriodDirty && (
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-16)" }}>
            <Button variant="primary" loading={savingP} onClick={handleSavePeriod}>
              Save period
            </Button>
            {savedP && <span style={{ fontSize: "var(--text-xs)", color: "var(--color-green)" }}>Saved</span>}
          </div>
        )}
      </div>

      <Divider />

      <div style={{ marginBottom: "var(--space-40)" }}>
        <div style={{ marginBottom: "var(--space-24)" }}>
          <SectionLabel>Case information</SectionLabel>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-24)" }}>
          {([
            ["Case ID",    case_.id],
            ["Created",    fmtDate(case_.created_at)],
            ["Tenant",     case_.tenant_id],
            ["Last updated", fmtDate(case_.updated_at)],
          ] as [string, string][]).map(([label, value]) => (
            <div key={label}>
              <p style={{ fontSize: "11px", fontWeight: 300, color: "var(--color-text-tertiary)", marginBottom: "4px" }}>{label}</p>
              <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-primary)", fontVariantNumeric: "tabular-nums", margin: 0, ...MONO }}>{value || "—"}</p>
            </div>
          ))}
        </div>
      </div>

      <Divider />

      <div>
        <div style={{ marginBottom: "var(--space-16)" }}>
          <SectionLabel>Danger zone</SectionLabel>
        </div>
        {!confirm ? (
          <div>
            <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", marginBottom: "var(--space-16)", lineHeight: 1.6 }}>
              Deleting a case permanently removes all documents, extracted data, and the audit chain. This cannot be undone.
            </p>
            <button
              onClick={() => setConfirm(true)}
              style={{ height: "40px", padding: "0 var(--space-24)", border: "none", borderRadius: "var(--btn-radius)", backgroundColor: "var(--color-red)", color: "#ffffff", fontSize: "var(--text-base)", fontWeight: "var(--font-focal)", fontFamily: "inherit", cursor: "pointer" }}
            >
              Delete case
            </button>
          </div>
        ) : (
          <div style={{ padding: "var(--space-24)", border: "var(--border-width) solid var(--color-red)", borderRadius: "8px" }}>
            <p style={{ fontSize: "var(--text-sm)", fontWeight: "var(--font-focal)", color: "var(--color-red)", marginBottom: "var(--space-8)" }}>
              Are you sure?
            </p>
            <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", marginBottom: "var(--space-16)", lineHeight: 1.6 }}>
              This will permanently delete the case and all associated data. The audit chain will be destroyed.
            </p>
            {deleteErr && (
              <p style={{ fontSize: "var(--text-sm)", color: "var(--color-red)", marginBottom: "var(--space-16)" }}>
                {deleteErr}
              </p>
            )}
            <div style={{ display: "flex", gap: "var(--space-16)" }}>
              <button
                onClick={handleDelete}
                disabled={deleting}
                style={{ height: "40px", padding: "0 var(--space-24)", border: "none", borderRadius: "6px", backgroundColor: "var(--color-red)", color: "#ffffff", fontSize: "var(--text-base)", fontWeight: "var(--font-focal)", fontFamily: "inherit", cursor: deleting ? "not-allowed" : "pointer", opacity: deleting ? 0.6 : 1 }}
              >
                {deleting ? "Deleting…" : "Delete permanently"}
              </button>
              <Button variant="secondary" onClick={() => setConfirm(false)}>Cancel</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
