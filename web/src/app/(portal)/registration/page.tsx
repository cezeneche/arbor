"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth/useAuth";
import { Button } from "@/components/ui/button";
import { ledgerFetch } from "@/lib/api/client";

// ── Types & constants ─────────────────────────────────────────────────────────

interface RegState {
  eori:          string;
  vat:           string;
  businessName:  string;
  address:       string;
  importValue:   string;
  hmrcSubmitted: boolean;
  hmrcRef:       string;
}

const EMPTY: RegState = {
  eori: "", vat: "", businessName: "", address: "",
  importValue: "", hmrcSubmitted: false, hmrcRef: "",
};

const ITEMS = [
  { key: "eori"          as const, label: "EORI number",                  inputType: "text"     as const, placeholder: "GB followed by 12 digits" },
  { key: "vat"           as const, label: "VAT registration number",       inputType: "text"     as const, placeholder: "" },
  { key: "businessName"  as const, label: "Business legal name",           inputType: "text"     as const, placeholder: "" },
  { key: "address"       as const, label: "Registered address",            inputType: "textarea" as const, placeholder: "" },
  { key: "importValue"   as const, label: "Estimated annual import value", inputType: "number"   as const, placeholder: "0" },
  { key: "hmrcSubmitted" as const, label: "HMRC registration submitted",   inputType: "checkbox" as const, placeholder: "" },
  { key: "hmrcRef"       as const, label: "HMRC reference number",         inputType: "text"     as const, placeholder: "" },
] as const;

type ItemKey = typeof ITEMS[number]["key"];

const STORAGE_KEY  = "nucleos_reg_state";
const API_BASE     = "/api-proxy/ledger/api/cbam/registration";
const THRESHOLD   = 50_000;
const DEADLINE    = new Date("2028-02-01"); // past 31 Jan 2028

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtGbp(n: number): string {
  return n.toLocaleString("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 });
}

function isComplete(key: ItemKey, s: RegState): boolean {
  if (key === "hmrcSubmitted") return s.hmrcSubmitted;
  return (s[key] as string).trim().length > 0;
}

function barColor(amount: number): string {
  if (amount > THRESHOLD)          return "var(--color-red)";
  if (amount > THRESHOLD * 0.8)    return "var(--color-amber)";
  return "var(--color-green)";
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Circle({ done }: { done: boolean }) {
  return (
    <div
      style={{
        width:           20,
        height:          20,
        borderRadius:    "50%",
        flexShrink:      0,
        marginTop:       2,
        backgroundColor: done ? "var(--color-green)" : "var(--color-surface)",
        border:          done ? "none" : "1.5px solid var(--color-border)",
        display:         "flex",
        alignItems:      "center",
        justifyContent:  "center",
      }}
    >
      {done && (
        <span style={{ color: "#fff", fontSize: 11, lineHeight: 1, fontWeight: 500 }}>✓</span>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        fontSize:      "var(--text-xs)",
        fontWeight:    "var(--font-focal)",
        color:         "var(--color-text-tertiary)",
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        margin:        "0 0 var(--space-16)",
      }}
    >
      {children}
    </p>
  );
}

const inputBase: React.CSSProperties = {
  width:           "100%",
  height:          "var(--input-height)",
  padding:         "0 var(--space-16)",
  fontSize:        "var(--text-base)",
  fontWeight:      "var(--font-body)",
  fontFamily:      "inherit",
  color:           "var(--color-text-primary)",
  backgroundColor: "var(--color-surface)",
  border:          "var(--border-width) solid var(--color-border)",
  borderRadius:    "var(--input-radius)",
  outline:         "none",
  boxSizing:       "border-box",
};

// ── Page ──────────────────────────────────────────────────────────────────────

export default function RegistrationPage() {
  const { user, isLoading } = useAuth();

  const [saved, setSaved]   = useState<RegState>(EMPTY);
  const [draft, setDraft]   = useState("");

  // Load from API (falls back to localStorage if API unavailable)
  useEffect(() => {
    async function load() {
      try {
        const data = await ledgerFetch<{ checklist: {
          eori_number?: string | null;
          vat_registration_number?: string | null;
          business_legal_name?: string | null;
          business_address?: { text?: string } | null;
          cbam_goods_import_value_estimate_gbp?: string | null;
          registration_status?: string | null;
          registration_reference?: string | null;
        } }>(`${API_BASE}/status`);
        const c = data.checklist;
        setSaved({
          eori:          c.eori_number ?? "",
          vat:           c.vat_registration_number ?? "",
          businessName:  c.business_legal_name ?? "",
          address:       c.business_address?.text ?? "",
          importValue:   c.cbam_goods_import_value_estimate_gbp ?? "",
          hmrcSubmitted: c.registration_status === "submitted" || c.registration_status === "confirmed",
          hmrcRef:       c.registration_reference ?? "",
        });
      } catch {
        // API unavailable — fall back to localStorage
        try {
          const raw = localStorage.getItem(STORAGE_KEY);
          if (raw) setSaved({ ...EMPTY, ...(JSON.parse(raw) as Partial<RegState>) });
        } catch { /* ignore */ }
      }
    }
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist to API on change (also mirror to localStorage as offline backup)
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(saved)); } catch { /* ignore */ }
    async function persist() {
      try {
        await ledgerFetch(`${API_BASE}`, {
          method: "PUT",
          body:   JSON.stringify({
            eori_number:                         saved.eori || null,
            vat_registration_number:             saved.vat || null,
            business_legal_name:                 saved.businessName || null,
            business_address:                    saved.address ? { text: saved.address } : null,
            cbam_goods_import_value_estimate_gbp: saved.importValue || null,
            registration_status:                 saved.hmrcSubmitted ? "submitted" : "in_progress",
            registration_reference:              saved.hmrcRef || null,
          }),
        });
      } catch { /* API unavailable — localStorage backup already written above */ }
    }
    persist();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved]);

  // Derived
  const currentStep    = ITEMS.findIndex(item => !isComplete(item.key, saved));
  const allDone        = currentStep === -1;
  const completedCount = ITEMS.filter(item => isComplete(item.key, saved)).length;
  const importAmount   = parseFloat(saved.importValue.replace(/[^0-9.]/g, "")) || 0;
  const barFillPct     = Math.min(importAmount / THRESHOLD, 1);
  const deadlinePast   = new Date() > DEADLINE;

  // Reset draft when active step advances; pre-fill businessName from account
  useEffect(() => {
    if (currentStep < 0) return;
    const key = ITEMS[currentStep].key;
    if (key === "businessName" && !saved.businessName && user?.name) {
      setDraft(user.name);
    } else {
      setDraft(key === "hmrcSubmitted" ? "" : (saved[key] as string));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStep]);

  function saveItem() {
    if (currentStep < 0) return;
    const key = ITEMS[currentStep].key;
    if (key === "hmrcSubmitted") return;
    setSaved(s => ({ ...s, [key]: draft.trim() }));
  }

  if (isLoading) return null;

  return (
    <div
      style={{
        maxWidth: 640,
        margin:   "0 auto",
        padding:  "var(--space-48) var(--space-32) var(--space-80)",
      }}
    >

      {/* ══ HEADER ══ */}
      <div
        style={{
          paddingBottom: "var(--space-32)",
          borderBottom:  "var(--border-width) solid var(--color-border)",
          marginBottom:  "var(--space-32)",
        }}
      >
        <h1
          style={{
            fontSize:     "var(--text-lg)",
            fontWeight:   "var(--font-focal)",
            color:        "var(--color-text-primary)",
            marginBottom: "var(--space-8)",
          }}
        >
          HMRC registration
        </h1>

        {allDone ? (
          <p
            style={{
              fontSize:   "var(--text-base)",
              fontWeight: "var(--font-focal)",
              color:      "var(--color-green)",
              margin:     0,
            }}
          >
            You&apos;re registration-ready
          </p>
        ) : (
          <p
            style={{
              fontSize:   "var(--text-base)",
              fontWeight: "var(--font-body)",
              color:      deadlinePast ? "var(--color-red)" : "var(--color-text-secondary)",
              margin:     0,
            }}
          >
            Due by 31 January 2028
          </p>
        )}
      </div>

      {/* ══ THRESHOLD STATUS ══ */}
      <div
        style={{
          paddingBottom: "var(--space-32)",
          borderBottom:  "var(--border-width) solid var(--color-border)",
          marginBottom:  "var(--space-32)",
        }}
      >
        <p
          style={{
            fontSize:     "var(--text-base)",
            fontWeight:   "var(--font-body)",
            color:        "var(--color-text-primary)",
            marginBottom: "var(--space-16)",
          }}
        >
          You have imported {fmtGbp(importAmount)} of goods in the last 12 months.
        </p>

        {/* Progress bar */}
        <div
          style={{
            position:        "relative",
            height:          8,
            borderRadius:    4,
            backgroundColor: "var(--color-border)",
            overflow:        "hidden",
            marginBottom:    "var(--space-8)",
          }}
        >
          <div
            style={{
              position:        "absolute",
              top:             0, left: 0, bottom: 0,
              width:           `${barFillPct * 100}%`,
              borderRadius:    4,
              backgroundColor: barColor(importAmount),
              transition:      "width var(--transition-normal), background-color var(--transition-normal)",
            }}
          />
        </div>

        <p
          style={{
            fontSize:   "var(--text-xs)",
            fontWeight: "var(--font-body)",
            color:      "var(--color-text-tertiary)",
            textAlign:  "right",
            margin:     0,
          }}
        >
          {fmtGbp(importAmount)} of {fmtGbp(THRESHOLD)} threshold
        </p>
      </div>

      {/* ══ CHECKLIST ══ */}
      <div>
        <SectionLabel>What you need</SectionLabel>

        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-24)" }}>
          {ITEMS.map((item, idx) => {
            const done   = isComplete(item.key, saved);
            const active = idx === currentStep;

            return (
              <div key={item.key} style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-16)" }}>
                <Circle done={done} />

                <div style={{ flex: 1, minWidth: 0 }}>
                  {/* Label */}
                  <p
                    style={{
                      fontSize:   "var(--text-base)",
                      fontWeight: "var(--font-body)",
                      color:      "var(--color-text-primary)",
                      margin:     0,
                      lineHeight: "var(--leading-body)",
                    }}
                  >
                    {item.label}
                  </p>

                  {/* ── Text input ── */}
                  {active && item.inputType === "text" && (
                    <div style={{ marginTop: "var(--space-16)", display: "flex", gap: "var(--space-8)", alignItems: "flex-start" }}>
                      <input
                        autoFocus
                        type="text"
                        value={draft}
                        placeholder={item.placeholder}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") saveItem(); }}
                        style={{ ...inputBase, flex: 1 }}
                      />
                      <Button
                        variant="secondary"
                        disabled={!draft.trim()}
                        onClick={saveItem}
                      >
                        Save
                      </Button>
                    </div>
                  )}

                  {/* ── Textarea input ── */}
                  {active && item.inputType === "textarea" && (
                    <div style={{ marginTop: "var(--space-16)", display: "flex", gap: "var(--space-8)", alignItems: "flex-start" }}>
                      <textarea
                        autoFocus
                        rows={3}
                        value={draft}
                        placeholder={item.placeholder}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter" && e.metaKey) saveItem(); }}
                        style={{
                          ...inputBase,
                          height:  "auto",
                          padding: "var(--space-8) var(--space-16)",
                          resize:  "vertical",
                          flex:    1,
                        }}
                      />
                      <Button
                        variant="secondary"
                        disabled={!draft.trim()}
                        onClick={saveItem}
                      >
                        Save
                      </Button>
                    </div>
                  )}

                  {/* ── Number input with £ prefix ── */}
                  {active && item.inputType === "number" && (
                    <div style={{ marginTop: "var(--space-16)", display: "flex", gap: "var(--space-8)", alignItems: "flex-start" }}>
                      <div style={{ display: "flex", flex: 1 }}>
                        <span
                          style={{
                            display:         "inline-flex",
                            alignItems:      "center",
                            justifyContent:  "center",
                            height:          "var(--input-height)",
                            paddingLeft:     "var(--space-16)",
                            paddingRight:    "var(--space-16)",
                            flexShrink:      0,
                            fontSize:        "var(--text-base)",
                            fontWeight:      "var(--font-body)",
                            color:           "var(--color-text-secondary)",
                            backgroundColor: "var(--color-surface)",
                            border:          "var(--border-width) solid var(--color-border)",
                            borderRight:     "none",
                            borderRadius:    "var(--input-radius) 0 0 var(--input-radius)",
                          }}
                        >
                          £
                        </span>
                        <input
                          autoFocus
                          type="number"
                          value={draft}
                          placeholder="0"
                          min={0}
                          onChange={(e) => setDraft(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") saveItem(); }}
                          style={{
                            ...inputBase,
                            flex:         1,
                            borderRadius: "0 var(--input-radius) var(--input-radius) 0",
                          }}
                        />
                      </div>
                      <Button
                        variant="secondary"
                        disabled={!draft.trim()}
                        onClick={saveItem}
                      >
                        Save
                      </Button>
                    </div>
                  )}

                  {/* ── Checkbox (HMRC submitted) ── */}
                  {active && item.inputType === "checkbox" && (
                    <div style={{ marginTop: "var(--space-16)" }}>
                      <label
                        style={{
                          display:    "flex",
                          alignItems: "center",
                          gap:        "var(--space-8)",
                          cursor:     "pointer",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={saved.hmrcSubmitted}
                          onChange={(e) =>
                            setSaved(s => ({ ...s, hmrcSubmitted: e.target.checked }))
                          }
                          style={{ width: 16, height: 16, cursor: "pointer", flexShrink: 0 }}
                        />
                        <span
                          style={{
                            fontSize:   "var(--text-base)",
                            fontWeight: "var(--font-body)",
                            color:      "var(--color-text-primary)",
                          }}
                        >
                          I have submitted my registration on the HMRC portal
                        </span>
                      </label>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Progress line */}
        <p
          style={{
            marginTop:  "var(--space-32)",
            fontSize:   "var(--text-sm)",
            fontWeight: "var(--font-body)",
            color:      "var(--color-text-secondary)",
          }}
        >
          {completedCount} of 7 complete
        </p>
      </div>

    </div>
  );
}
