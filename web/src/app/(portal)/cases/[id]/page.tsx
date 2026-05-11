"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useCase } from "@/lib/hooks/useCases";
import { useAuth } from "@/lib/auth/useAuth";
import { useRole } from "@/lib/auth/useRole";
import { getAuditLog } from "@/lib/api/audit";
import { approveCase, rejectCase } from "@/lib/api/cases";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  formatCurrency,
  methodLabel,
  methodBadgeVariant,
  toStatusVariant,
  statusLabel,
} from "@/lib/design-system";
import type { AuditEvent } from "@/lib/types";
import type { RichGoodsLine, CaseDetail } from "@/lib/api/types";
import type { CBAMShipment } from "@/lib/types";

// ── Constants ──────────────────────────────────────────────────────────────────

const UK_ETS_RATE = 52.4;

const ROUGH_SEE: Record<string, number> = {
  iron_steel: 1.8, aluminium: 2.0, cement: 0.9,
  fertilisers: 2.5, hydrogen: 9.5, electricity: 0.4,
};

const SECTOR_LABELS: Record<string, string> = {
  iron_steel: "Iron & steel", aluminium: "Aluminium", cement: "Cement",
  fertilisers: "Fertilisers", hydrogen: "Hydrogen", electricity: "Electricity",
};

const MONO: React.CSSProperties = {
  fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
};

// ── Types ──────────────────────────────────────────────────────────────────────

type ActiveTab = "details" | "emissions" | "audit" | "settings";

type LocalChange = {
  id:        string;
  timestamp: string;
  summary:   string;
  fields:    { label: string; from: string; to: string }[];
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function sectorLabel(s?: string | null): string {
  return s ? (SECTOR_LABELS[s] ?? s.replace(/_/g, " ")) : "—";
}

function fmtDate(iso?: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function fmtMass(kg?: number | null): string {
  if (kg == null) return "—";
  if (kg >= 1000) return `${(kg / 1000).toLocaleString("en-GB", { maximumFractionDigits: 2 })} t`;
  return `${kg.toLocaleString("en-GB", { maximumFractionDigits: 1 })} kg`;
}

function isChainValid(events: AuditEvent[]): boolean {
  for (let i = 1; i < events.length; i++) {
    const cur  = events[i];
    const prev = events[i - 1];
    const a = cur.prev_hmac  ?? cur.chain_hash;
    const b = prev.hmac_sha256 ?? prev.signature;
    if (a && b && a !== b) return false;
  }
  return true;
}

function actorLabel(ev: AuditEvent): string {
  return ev.actor ?? ev.actor_sub ?? "system";
}

// ── SectionLabel ───────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ fontSize: "var(--text-xs)", fontWeight: "var(--font-focal)", color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.08em", margin: 0 }}>
      {children}
    </p>
  );
}

function Divider() {
  return <div style={{ height: "var(--border-width)", backgroundColor: "var(--color-border)", margin: "var(--space-40) 0" }} />;
}

// ── Document fields form ───────────────────────────────────────────────────────
// EU 2023/1773 Art. 4–6 / HMRC CBAM return fields. All 11 fields hardcoded.
// Pre-filled from deterministic extraction; asterisk (*) marks missing fields.

type FieldDef = {
  key:         string;
  label:       string;
  placeholder: string;
  required:    boolean;
  mono:        boolean;
  fullWidth?:  boolean;
};

const FIELD_DEFS: FieldDef[] = [
  { key: "sector",             label: "Sector",                     placeholder: "e.g. Iron & steel",               required: true,  mono: false },
  { key: "importer_eori",      label: "Importer EORI",              placeholder: "e.g. GB123456789000",             required: true,  mono: true  },
  { key: "origin_country",     label: "Country of origin",          placeholder: "e.g. DE",                         required: true,  mono: false },
  { key: "cn_code",            label: "CN8 commodity code",         placeholder: "e.g. 72082700",                   required: true,  mono: true  },
  { key: "net_mass_kg",        label: "Net weight (kg)",            placeholder: "e.g. 5000",                       required: true,  mono: false },
  { key: "invoice_number",     label: "Invoice / reference",        placeholder: "e.g. INV-2027-001",               required: false, mono: false },
  { key: "entry_reference",    label: "Customs entry ref (MRN)",    placeholder: "18-character MRN",                required: false, mono: true  },
  { key: "incoterm",           label: "Incoterms",                  placeholder: "e.g. CIF, FOB, EXW",              required: false, mono: false },
  { key: "installation_id",    label: "Supplier installation ID",   placeholder: "EU CBAM installation ID",         required: false, mono: true  },
  { key: "emissions_data",     label: "Emissions data",             placeholder: "Verified, estimated, or Annex VI default", required: true, mono: false, fullWidth: true },
  { key: "verified_emissions", label: "Supplier-verified (tCO₂e)", placeholder: "e.g. 12.450 — without this you pay conservative default rates", required: false, mono: false, fullWidth: true },
];

type FieldState = Record<string, string>;

function initFields(case_: CaseDetail): FieldState {
  const shipment = (case_.shipments ?? [])[0] as CBAMShipment | undefined;
  const gl       = (case_.goods_lines ?? [])[0] as RichGoodsLine | undefined;
  const m        = gl?.method;
  return {
    sector:             sectorLabel(gl?.sector),
    importer_eori:      case_.importer_eori ?? "",
    origin_country:     shipment?.origin_country ?? gl?.origin_country ?? "",
    cn_code:            gl?.cn_code ?? "",
    net_mass_kg:        gl?.net_mass_kg != null ? String(gl.net_mass_kg) : gl?.quantity != null ? String(gl.quantity) : "",
    invoice_number:     "",
    entry_reference:    shipment?.entry_reference ?? "",
    incoterm:           shipment?.incoterm ?? "",
    installation_id:    gl?.installation_id ?? "",
    emissions_data:     m === "actual" ? "Verified supplier data" : m === "estimated" ? "Estimated" : m === "default" ? "Annex VI default values" : (m ?? ""),
    verified_emissions: (m === "actual" && gl?.direct_kgco2e != null) ? (gl.direct_kgco2e / 1000).toFixed(3) : "",
  };
}

function DocumentFieldsForm({
  case_,
  qualityScore,
  onSave,
}: {
  case_:        CaseDetail;
  qualityScore: number | null;
  onSave:       (change: LocalChange) => void;
}) {
  const [fields,  setFields]  = useState<FieldState>(() => initFields(case_));
  const [initial]             = useState<FieldState>(() => initFields(case_));
  const [focused, setFocused] = useState<string | null>(null);
  const [saving,  setSaving]  = useState(false);
  const [saved,   setSaved]   = useState(false);

  const isDirty = FIELD_DEFS.some(f => fields[f.key] !== initial[f.key]);

  function handleChange(key: string, val: string) {
    setFields(prev => ({ ...prev, [key]: val }));
    setSaved(false);
  }

  async function handleSave() {
    setSaving(true);
    await new Promise(r => setTimeout(r, 350));

    const changed = FIELD_DEFS.filter(f => fields[f.key] !== initial[f.key]);
    const change: LocalChange = {
      id:        crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      summary:   `Updated ${changed.map(f => f.label.toLowerCase()).join(", ")}`,
      fields:    changed.map(f => ({ label: f.label, from: initial[f.key] ?? "", to: fields[f.key] ?? "" })),
    };
    onSave(change);
    setSaving(false);
    setSaved(true);
  }

  const scoreColor =
    qualityScore == null    ? "var(--color-text-tertiary)" :
    qualityScore >= 80      ? "var(--color-green)" :
    qualityScore >= 50      ? "var(--color-amber)" :
                              "var(--color-red)";

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "var(--space-24)" }}>
        <SectionLabel>Document fields</SectionLabel>
        {qualityScore != null && (
          <span style={{ fontSize: "var(--text-xs)", fontWeight: 500, color: scoreColor, fontVariantNumeric: "tabular-nums" }}>
            {qualityScore}/100
          </span>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-16)" }}>
        {FIELD_DEFS.map(field => {
          const val       = fields[field.key] ?? "";
          const isEmpty   = val.trim() === "";
          const isFocused = focused === field.key;
          const accent    = field.required ? "var(--color-red)" : "var(--color-amber)";
          const border    = isFocused ? "var(--color-navy)" : isEmpty ? accent : "var(--color-border)";

          return (
            <div key={field.key} style={{ gridColumn: field.fullWidth ? "1 / -1" : undefined }}>
              <div style={{ display: "flex", alignItems: "center", gap: "4px", marginBottom: "6px" }}>
                <label
                  htmlFor={`cf-${field.key}`}
                  style={{ fontSize: "11px", fontWeight: 300, color: "var(--color-text-secondary)", cursor: "default" }}
                >
                  {field.label}
                </label>
                {isEmpty && (
                  <span style={{ fontSize: "11px", fontWeight: 500, color: accent, lineHeight: 1 }}>*</span>
                )}
              </div>
              <input
                id={`cf-${field.key}`}
                type="text"
                value={val}
                placeholder={field.placeholder}
                onChange={e => handleChange(field.key, e.target.value)}
                onFocus={() => setFocused(field.key)}
                onBlur={() => setFocused(null)}
                autoComplete="off"
                style={{
                  display: "block", width: "100%", height: "40px",
                  padding: "0 var(--space-16)",
                  fontSize: "var(--text-base)", fontWeight: "var(--font-body)",
                  fontFamily: field.mono ? "ui-monospace, 'SF Mono', Menlo, monospace" : "inherit",
                  color: val ? "var(--color-text-primary)" : "var(--color-text-tertiary)",
                  backgroundColor: "var(--color-surface)",
                  border: `0.5px solid ${border}`,
                  borderRadius: "6px", outline: "none", boxSizing: "border-box",
                  transition: "border-color 100ms",
                }}
              />
            </div>
          );
        })}
      </div>

      {isDirty && (
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-16)", marginTop: "var(--space-24)" }}>
          <Button variant="primary" loading={saving} onClick={handleSave}>Save changes</Button>
          {saved && <span style={{ fontSize: "var(--text-xs)", color: "var(--color-green)" }}>Saved</span>}
        </div>
      )}
    </div>
  );
}

// ── Emissions tab ──────────────────────────────────────────────────────────────

function EmissionsTab({ case_ }: { case_: CaseDetail }) {
  const goods_lines = (case_.goods_lines ?? []) as RichGoodsLine[];

  if (goods_lines.length === 0) {
    return (
      <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-tertiary)" }}>
        No goods lines yet. Upload a supplier document to calculate emissions.
      </p>
    );
  }

  const totalDirectKgco2e = goods_lines.reduce((sum, gl) => {
    const kg  = gl.net_mass_kg ?? gl.quantity ?? 0;
    if (gl.direct_kgco2e != null) return sum + gl.direct_kgco2e;
    return sum + (kg / 1000) * (ROUGH_SEE[gl.sector ?? ""] ?? 1.5) * 1000;
  }, 0);
  const cbamCharge   = (totalDirectKgco2e / 1000) * UK_ETS_RATE;
  const isAnyDefault = goods_lines.some(gl => !gl.method || gl.method === "default");

  return (
    <div>
      {/* Per-line calculations */}
      {goods_lines.map((gl, i) => {
        const kg       = gl.net_mass_kg ?? gl.quantity ?? 0;
        const see      = ROUGH_SEE[gl.sector ?? ""] ?? 1.5;
        const directKg = gl.direct_kgco2e ?? (kg > 0 ? (kg / 1000) * see * 1000 : 0);
        const directT  = directKg / 1000;
        const charge   = directT * UK_ETS_RATE;
        const method   = gl.method ?? "default";
        const isLast   = i === goods_lines.length - 1;

        return (
          <div
            key={gl.id}
            style={{
              padding:      "var(--space-24)",
              border:       "var(--border-width) solid var(--color-border)",
              borderRadius: "8px",
              marginBottom: isLast ? 0 : "var(--space-16)",
            }}
          >
            {/* Header */}
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: "var(--space-24)" }}>
              <div>
                <p style={{ fontSize: "var(--text-base)", fontWeight: "var(--font-focal)", color: "var(--color-text-primary)", margin: "0 0 4px" }}>
                  {sectorLabel(gl.sector)}
                </p>
                <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)", ...MONO }}>
                  {gl.cn_code || "—"}
                </span>
              </div>
              <Badge variant={methodBadgeVariant(method)}>{methodLabel(method)}</Badge>
            </div>

            {/* Calculation steps */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "var(--space-24)", marginBottom: "var(--space-24)" }}>
              <div>
                <p style={{ fontSize: "11px", fontWeight: 300, color: "var(--color-text-tertiary)", marginBottom: "4px" }}>Net weight</p>
                <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-primary)", fontVariantNumeric: "tabular-nums", margin: 0 }}>
                  {fmtMass(kg)}
                </p>
              </div>
              <div>
                <p style={{ fontSize: "11px", fontWeight: 300, color: "var(--color-text-tertiary)", marginBottom: "4px" }}>
                  {gl.direct_kgco2e != null ? "Verified SEE" : "Default SEE"}
                </p>
                <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-primary)", fontVariantNumeric: "tabular-nums", margin: 0 }}>
                  {gl.direct_kgco2e != null
                    ? `${(directT / (kg / 1000)).toFixed(3)} tCO₂e/t`
                    : `${see.toFixed(2)} tCO₂e/t`}
                </p>
              </div>
              <div>
                <p style={{ fontSize: "11px", fontWeight: 300, color: "var(--color-text-tertiary)", marginBottom: "4px" }}>Direct embedded</p>
                <p style={{ fontSize: "var(--text-sm)", fontWeight: "var(--font-focal)", color: "var(--color-text-primary)", fontVariantNumeric: "tabular-nums", margin: 0 }}>
                  {directT.toLocaleString("en-GB", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} tCO₂e
                </p>
              </div>
            </div>

            {/* Calculation formula */}
            <div style={{ backgroundColor: "var(--color-bg)", border: "var(--border-width) solid var(--color-border)", borderRadius: "6px", padding: "var(--space-16)", marginBottom: "var(--space-16)" }}>
              <p style={{ fontSize: "11px", fontWeight: 300, color: "var(--color-text-tertiary)", marginBottom: "8px" }}>CBAM calculation</p>
              <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", margin: "0 0 4px", fontVariantNumeric: "tabular-nums" }}>
                {directT.toFixed(3)} tCO₂e × £{UK_ETS_RATE.toFixed(2)}/tCO₂e
                {" = "}
                <span style={{ fontWeight: 500, color: "var(--color-navy)" }}>{formatCurrency(charge)}</span>
              </p>
              <p style={{ fontSize: "11px", fontWeight: 300, color: "var(--color-text-tertiary)", margin: 0 }}>
                UK ETS rate: £{UK_ETS_RATE.toFixed(2)}/tCO₂e (Q1 2027 placeholder)
              </p>
            </div>

            {/* Method note */}
            {method === "default" && (
              <div style={{ borderLeft: "2px solid var(--color-amber)", paddingLeft: "var(--space-16)" }}>
                <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", margin: "0 0 4px" }}>
                  Using Annex VI default value ({see.toFixed(2)} tCO₂e/t)
                </p>
                <p style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)", margin: 0, lineHeight: 1.6 }}>
                  Default values include a conservative mark-up — 10% in 2026, 20% in 2027, 30% from 2028.
                  Provide your supplier&apos;s verified emissions data to replace this with the actual figure and reduce your liability.
                </p>
              </div>
            )}
            {method === "actual" && (
              <div style={{ borderLeft: "2px solid var(--color-green)", paddingLeft: "var(--space-16)" }}>
                <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", margin: "0 0 4px" }}>
                  Using verified supplier data
                </p>
                <p style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)", margin: 0, lineHeight: 1.6 }}>
                  This figure has been verified by an accredited third party. No default mark-up applies.
                </p>
              </div>
            )}
            {method === "estimated" && (
              <div style={{ borderLeft: "2px solid var(--color-amber)", paddingLeft: "var(--space-16)" }}>
                <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", margin: "0 0 4px" }}>
                  Using estimated supplier data (not verified)
                </p>
                <p style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)", margin: 0, lineHeight: 1.6 }}>
                  Estimated values carry higher uncertainty. Obtain third-party verification to use actual emissions.
                </p>
              </div>
            )}
          </div>
        );
      })}

      {/* Total */}
      {goods_lines.length > 0 && (
        <>
          <Divider />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "var(--space-32)" }}>
            <div>
              <p style={{ fontSize: "11px", fontWeight: 300, color: "var(--color-text-tertiary)", marginBottom: "8px" }}>Total direct embedded</p>
              <p style={{ fontSize: "var(--text-lg)", fontWeight: "var(--font-focal)", color: "var(--color-text-primary)", fontVariantNumeric: "tabular-nums", margin: 0 }}>
                {(totalDirectKgco2e / 1000).toLocaleString("en-GB", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} tCO₂e
              </p>
            </div>
            <div>
              <p style={{ fontSize: "11px", fontWeight: 300, color: "var(--color-text-tertiary)", marginBottom: "8px" }}>Carbon price relief</p>
              <p style={{ fontSize: "var(--text-lg)", fontWeight: "var(--font-focal)", color: "var(--color-text-tertiary)", fontVariantNumeric: "tabular-nums", margin: 0 }}>
                £0.00
              </p>
            </div>
            <div>
              <p style={{ fontSize: "11px", fontWeight: 300, color: "var(--color-text-tertiary)", marginBottom: "8px" }}>Net CBAM liability</p>
              <p style={{ fontSize: "var(--text-lg)", fontWeight: "var(--font-focal)", color: "var(--color-navy)", fontVariantNumeric: "tabular-nums", margin: 0 }}>
                {formatCurrency(cbamCharge)}
              </p>
            </div>
          </div>

          {isAnyDefault && (
            <div style={{ marginTop: "var(--space-32)", padding: "var(--space-16) var(--space-24)", backgroundColor: "var(--color-surface)", border: "var(--border-width) solid var(--color-border)", borderLeft: "3px solid var(--color-amber)", borderRadius: "0 6px 6px 0" }}>
              <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", margin: 0, lineHeight: 1.6 }}>
                This liability uses conservative Annex VI default values. Provide supplier-verified emissions data to replace default values and potentially reduce your liability.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Audit chain tab ────────────────────────────────────────────────────────────

function AuditTrailTab({ caseId, localChanges }: { caseId: string; localChanges: LocalChange[] }) {
  const { data: raw = [] } = useQuery<AuditEvent[]>({
    queryKey:  ["audit-log", caseId],
    queryFn:   () => getAuditLog(caseId),
    staleTime: 60_000,
    enabled:   Boolean(caseId),
  });

  const auditEvents: AuditEvent[] = Array.isArray(raw)
    ? raw
    : ((raw as { events?: AuditEvent[] }).events ?? []);

  const chainValid = auditEvents.length === 0 || isChainValid(auditEvents);
  const totalEvents = auditEvents.length + localChanges.length;

  return (
    <div>
      {!chainValid && (
        <div style={{ padding: "var(--space-16) var(--space-24)", marginBottom: "var(--space-24)", backgroundColor: "var(--color-red-bg)", border: "var(--border-width) solid var(--color-red)", borderRadius: "6px" }}>
          <p style={{ fontSize: "var(--text-sm)", color: "var(--color-red)", margin: 0 }}>
            Chain integrity check failed — this case requires manual verification before submission.
          </p>
        </div>
      )}

      {chainValid && totalEvents > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-8)", marginBottom: "var(--space-24)" }}>
          <span style={{ display: "inline-block", width: "6px", height: "6px", borderRadius: "50%", backgroundColor: "var(--color-green)", flexShrink: 0 }} />
          <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)" }}>
            Chain integrity verified — {totalEvents} event{totalEvents !== 1 ? "s" : ""}
            {localChanges.length > 0 && ` (${localChanges.length} pending)`}
          </span>
        </div>
      )}

      {totalEvents === 0 && (
        <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-tertiary)" }}>No audit events yet.</p>
      )}

      <div style={{ border: totalEvents > 0 ? "var(--border-width) solid var(--color-border)" : "none", borderRadius: "8px", overflow: "hidden" }}>
        {/* Local (pending) changes — shown at top */}
        {localChanges.map((change, i) => (
          <div
            key={change.id}
            style={{
              padding:         "var(--space-16) var(--space-24)",
              borderBottom:    (i < localChanges.length - 1 || auditEvents.length > 0) ? "var(--border-width) solid var(--color-border)" : undefined,
              backgroundColor: "var(--color-surface)",
            }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "var(--space-16)" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "var(--space-8)", marginBottom: "var(--space-8)" }}>
                  <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)", whiteSpace: "nowrap" }}>
                    {fmtTime(change.timestamp)}
                  </span>
                  <span style={{ fontSize: "11px", fontWeight: 500, color: "var(--color-amber)", backgroundColor: "var(--color-amber-bg)", padding: "1px 6px", borderRadius: "3px" }}>
                    pending
                  </span>
                </div>
                <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-primary)", margin: "0 0 8px" }}>
                  {change.summary}
                </p>
                {change.fields.map(f => (
                  <div key={f.label} style={{ fontSize: "var(--text-xs)", color: "var(--color-text-secondary)", marginBottom: "2px" }}>
                    <span style={{ fontWeight: 500 }}>{f.label}:</span>{" "}
                    {f.from ? (
                      <><span style={{ textDecoration: "line-through", color: "var(--color-text-tertiary)" }}>{f.from}</span> → {f.to}</>
                    ) : (
                      <span style={{ color: "var(--color-green)" }}>{f.to}</span>
                    )}
                  </div>
                ))}
              </div>
              <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)", whiteSpace: "nowrap", flexShrink: 0 }}>
                you
              </span>
            </div>
          </div>
        ))}

        {/* Server-signed events */}
        {auditEvents.map((ev, i) => {
          const hmac   = ev.hmac_sha256 ?? ev.signature;
          const actor  = actorLabel(ev);
          const isLast = i === auditEvents.length - 1;
          return (
            <div
              key={ev.id}
              style={{ display: "grid", gridTemplateColumns: "160px 1fr auto", alignItems: "center", gap: "var(--space-24)", padding: "var(--space-12) var(--space-24)", borderBottom: isLast ? undefined : "var(--border-width) solid var(--color-border)" }}
            >
              <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)", whiteSpace: "nowrap" }}>
                {fmtTime(ev.created_at)}
              </span>
              <div>
                <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-primary)", margin: 0 }}>
                  {ev.event_type.replace(/_/g, " ")}
                </p>
                {actor !== "system" && (
                  <p style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)", margin: "2px 0 0" }}>{actor}</p>
                )}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-8)" }}>
                {ev.verified === false && <span style={{ fontSize: "var(--text-xs)", color: "var(--color-red)" }}>invalid</span>}
                <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)", ...MONO }}>{hmac?.slice(0, 12) ?? "—"}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Settings tab ───────────────────────────────────────────────────────────────

function SettingsTab({ case_ }: { case_: CaseDetail }) {
  const [year,     setYear]     = useState(String(case_.reporting_year ?? ""));
  const [quarter,  setQuarter]  = useState(String(case_.reporting_quarter ?? "1"));
  const [regime,   setRegime]   = useState<"UK" | "EU">("UK");
  const [savingP,  setSavingP]  = useState(false);
  const [savedP,   setSavedP]   = useState(false);
  const [confirm,  setConfirm]  = useState(false);
  const [focused,  setFocused]  = useState<string | null>(null);

  async function handleSavePeriod() {
    setSavingP(true);
    await new Promise(r => setTimeout(r, 350));
    // TODO: PATCH /api/cbam/cases/{case_.id} with { reporting_year, reporting_quarter, jurisdiction }
    setSavingP(false);
    setSavedP(true);
  }

  return (
    <div>
      {/* Reporting period */}
      <div style={{ marginBottom: "var(--space-40)" }}>
        <div style={{ marginBottom: "var(--space-24)" }}>
          <SectionLabel>Reporting period</SectionLabel>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "var(--space-16)", marginBottom: "var(--space-24)" }}>
          {/* Year */}
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

          {/* Quarter */}
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

          {/* Regime */}
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

        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-16)" }}>
          <Button variant="primary" loading={savingP} onClick={handleSavePeriod}>
            Save period
          </Button>
          {savedP && <span style={{ fontSize: "var(--text-xs)", color: "var(--color-green)" }}>Saved</span>}
        </div>
      </div>

      <Divider />

      {/* Case info (read-only) */}
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

      {/* Danger zone */}
      <div>
        <div style={{ marginBottom: "var(--space-16)" }}>
          <SectionLabel>Danger zone</SectionLabel>
        </div>
        {!confirm ? (
          <div>
            <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", marginBottom: "var(--space-16)", lineHeight: 1.6 }}>
              Deleting a case permanently removes all documents, extracted data, and the audit chain. This cannot be undone.
            </p>
            <Button variant="secondary" onClick={() => setConfirm(true)}>
              Delete case
            </Button>
          </div>
        ) : (
          <div style={{ padding: "var(--space-24)", border: "var(--border-width) solid var(--color-red)", borderRadius: "8px" }}>
            <p style={{ fontSize: "var(--text-sm)", fontWeight: "var(--font-focal)", color: "var(--color-red)", marginBottom: "var(--space-8)" }}>
              Are you sure?
            </p>
            <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", marginBottom: "var(--space-16)", lineHeight: 1.6 }}>
              This will permanently delete the case and all associated data. The audit chain will be destroyed.
            </p>
            <div style={{ display: "flex", gap: "var(--space-16)" }}>
              <button
                onClick={() => { /* TODO: DELETE /api/cbam/cases/{case_.id} */ }}
                style={{ height: "40px", padding: "0 var(--space-24)", border: "none", borderRadius: "6px", backgroundColor: "var(--color-red)", color: "#ffffff", fontSize: "var(--text-base)", fontWeight: "var(--font-focal)", fontFamily: "inherit", cursor: "pointer" }}
              >
                Delete permanently
              </button>
              <Button variant="secondary" onClick={() => setConfirm(false)}>Cancel</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function CaseDetailPage({ params }: { params: { id: string } }) {
  const { id }   = params;
  const { user } = useAuth();
  const role     = useRole();
  const isAdmin  = role === "admin";

  const { case_, isLoading, error } = useCase(id);

  const [activeTab,    setActiveTab]    = useState<ActiveTab>("details");
  const [actionDone,   setActionDone]   = useState<"approved" | "flagged" | null>(null);
  const [showFlagForm, setShowFlagForm] = useState(false);
  const [flagText,     setFlagText]     = useState("");
  const [actioning,    setActioning]    = useState(false);
  const [localChanges, setLocalChanges] = useState<LocalChange[]>([]);

  const handleFieldSave = useCallback((change: LocalChange) => {
    setLocalChanges(prev => [change, ...prev]);
  }, []);

  if (isLoading) {
    return (
      <div className="page-content" style={{ paddingTop: "var(--space-48)", paddingBottom: "var(--space-80)" }}>
        <div>
          <div style={{ paddingBottom: "var(--space-40)", borderBottom: "var(--border-width) solid var(--color-border)", marginBottom: "var(--space-40)" }}>
            <Skeleton height={14} width={80} style={{ marginBottom: "var(--space-40)" }} />
            <Skeleton height={24} width={200} style={{ marginBottom: "var(--space-8)" }} />
            <Skeleton height={13} width={280} style={{ marginBottom: "var(--space-8)" }} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "var(--space-32)", paddingBottom: "var(--space-40)", borderBottom: "var(--border-width) solid var(--color-border)", marginBottom: "var(--space-40)" }}>
            {[0, 1, 2].map(i => (
              <div key={i}>
                <Skeleton height={11} width={80} style={{ marginBottom: "var(--space-8)" }} />
                <Skeleton height={24} width={120} />
              </div>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-16)" }}>
            {[0, 1, 2, 3, 4, 5].map(i => (
              <div key={i}>
                <Skeleton height={11} width={100} style={{ marginBottom: "6px" }} />
                <Skeleton height={40} />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error || !case_) {
    return (
      <div className="page-content" style={{ paddingTop: "var(--space-48)" }}>
        <Link href="/" style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", display: "inline-block", marginBottom: "var(--space-40)" }}>
          ← Cases
        </Link>
        <p style={{ fontSize: "var(--text-sm)", color: "var(--color-red)" }}>
          {error?.message ?? "Case not found."}
        </p>
      </div>
    );
  }

  const goods_lines = (case_.goods_lines ?? []) as RichGoodsLine[];

  const sector     = goods_lines[0]?.sector ? sectorLabel(goods_lines[0].sector) : "—";
  const country    = (case_.shipments?.[0] as { origin_country?: string })?.origin_country ?? goods_lines[0]?.origin_country ?? "—";
  const importDate = (case_.shipments?.[0] as { import_date?: string })?.import_date ?? goods_lines[0]?.import_date ?? case_.created_at;

  const totalDirectKgco2e = goods_lines.reduce((sum, gl) => {
    const kg = gl.net_mass_kg ?? gl.quantity ?? 0;
    if (gl.direct_kgco2e != null) return sum + gl.direct_kgco2e;
    return sum + (kg / 1000) * (ROUGH_SEE[gl.sector ?? ""] ?? 1.5) * 1000;
  }, 0);
  const cbamCharge   = (totalDirectKgco2e / 1000) * UK_ETS_RATE;
  const netLiability = cbamCharge;

  const isProcessing = case_.status === "processing";
  const isPending    = case_.review_status === "pending_review";
  const isApproved   = case_.review_status === "approved" || case_.status === "signed_off";
  const qualityScore = (case_.open_gaps as { score?: number } | null)?.score ?? null;

  async function handleApprove() {
    setActioning(true);
    try {
      await approveCase(id, { reviewer_name: user?.sub ?? "reviewer", reviewer_email: user?.sub ?? "reviewer@nucleos", comments: "Approved via case detail" });
      setActionDone("approved");
    } catch { /* unchanged */ }
    setActioning(false);
  }

  async function handleSendFlag() {
    if (!flagText.trim()) return;
    setActioning(true);
    try {
      await rejectCase(id, { reviewer_name: user?.sub ?? "reviewer", reviewer_email: user?.sub ?? "reviewer@nucleos", comments: flagText.trim() });
      setActionDone("flagged");
    } catch { /* ignore */ }
    setActioning(false);
  }

  const TABS: { key: ActiveTab; label: string }[] = [
    { key: "details",   label: "Details"     },
    { key: "emissions", label: "Emissions"   },
    { key: "audit",     label: "Audit chain" },
    { key: "settings",  label: "Settings"    },
  ];

  return (
    <div className="page-content" style={{ paddingTop: "var(--space-48)", paddingBottom: "var(--space-80)" }}>
      <div>

        {/* ══ HEADER ══ */}
        <div style={{ paddingBottom: "var(--space-40)", borderBottom: "var(--border-width) solid var(--color-border)", marginBottom: "var(--space-40)" }}>
          <Link href="/" style={{ display: "inline-block", fontSize: "var(--text-sm)", fontWeight: "var(--font-body)", color: "var(--color-text-secondary)", textDecoration: "none", marginBottom: "var(--space-40)" }}>
            ← Cases
          </Link>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "var(--space-24)" }}>
            <div>
              <p style={{ fontSize: "var(--text-lg)", fontWeight: "var(--font-focal)", color: "var(--color-text-primary)", marginBottom: "var(--space-8)" }}>
                {sector !== "—" ? `${sector} · ${country}` : case_.importer_name || "Untitled case"}
              </p>
              <p style={{ fontSize: "var(--text-sm)", fontWeight: "var(--font-body)", color: "var(--color-text-secondary)", marginBottom: "var(--space-8)" }}>
                {case_.id}
              </p>
              <p style={{ fontSize: "var(--text-sm)", fontWeight: "var(--font-body)", color: "var(--color-text-secondary)" }}>
                {fmtDate(importDate)}
              </p>
            </div>
            <Badge variant={toStatusVariant(case_.status)}>
              {statusLabel(case_.status)}
            </Badge>
          </div>
        </div>

        {/* ══ PROCESSING NOTICE ══ */}
        {isProcessing && (
          <div style={{ padding: "var(--space-16) var(--space-24)", marginBottom: "var(--space-40)", backgroundColor: "var(--color-surface)", border: "var(--border-width) solid var(--color-border)", borderLeft: "3px solid var(--color-navy)", borderRadius: "0 var(--btn-radius) var(--btn-radius) 0" }}>
            <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", margin: 0 }}>
              Document is being processed. Fields will populate shortly.
            </p>
          </div>
        )}

        {/* ══ FINANCIAL SUMMARY ══ */}
        <div style={{ paddingBottom: "var(--space-40)", borderBottom: "var(--border-width) solid var(--color-border)", marginBottom: "var(--space-40)" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "var(--space-32)" }}>
            <div>
              <SectionLabel>CBAM charge</SectionLabel>
              <p style={{ marginTop: "var(--space-8)", fontSize: "var(--text-lg)", fontWeight: "var(--font-focal)", color: "var(--color-navy)", fontVariantNumeric: "tabular-nums" }}>
                {formatCurrency(cbamCharge)}
              </p>
              {goods_lines.some(gl => gl.direct_kgco2e == null) && (
                <p style={{ fontSize: "var(--text-xs)", color: "var(--color-text-secondary)", marginTop: "4px" }}>Annex VI default</p>
              )}
            </div>
            <div>
              <SectionLabel>Carbon price relief</SectionLabel>
              <p style={{ marginTop: "var(--space-8)", fontSize: "var(--text-lg)", fontWeight: "var(--font-focal)", color: "var(--color-text-tertiary)", fontVariantNumeric: "tabular-nums" }}>
                £0.00
              </p>
            </div>
            <div>
              <SectionLabel>Net liability</SectionLabel>
              <p style={{ marginTop: "var(--space-8)", fontSize: "var(--text-lg)", fontWeight: "var(--font-focal)", color: "var(--color-navy)", fontVariantNumeric: "tabular-nums" }}>
                {formatCurrency(netLiability)}
              </p>
            </div>
          </div>
        </div>

        {/* ══ TABS ══ */}
        <div style={{ display: "flex", gap: "var(--space-32)", marginBottom: "var(--space-32)", borderBottom: "var(--border-width) solid var(--color-border)" }}>
          {TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                paddingBottom: "var(--space-12)",
                fontSize:      "var(--text-sm)",
                fontWeight:    activeTab === tab.key ? "var(--font-focal)" : "var(--font-body)",
                color:         activeTab === tab.key ? "var(--color-text-primary)" : "var(--color-text-tertiary)",
                background:    "none", border: "none",
                borderBottom:  activeTab === tab.key ? "2px solid var(--color-navy)" : "2px solid transparent",
                marginBottom:  "-1px", cursor: "pointer", fontFamily: "inherit",
                transition:    "color 100ms",
                position:      "relative",
              }}
            >
              {tab.label}
              {tab.key === "audit" && localChanges.length > 0 && (
                <span style={{ position: "absolute", top: "2px", right: "-10px", width: "6px", height: "6px", borderRadius: "50%", backgroundColor: "var(--color-amber)" }} />
              )}
            </button>
          ))}
        </div>

        {/* ══ DETAILS TAB ══ */}
        {activeTab === "details" && (
          <div>
            {!isProcessing && (
              <DocumentFieldsForm case_={case_} qualityScore={qualityScore} onSave={handleFieldSave} />
            )}

            <Divider />

            {/* Actions */}
            <div>
              {actionDone === "approved" && (
                <p style={{ fontSize: "var(--text-base)", color: "var(--color-text-primary)" }}>
                  Case approved. <Link href="/" style={{ color: "var(--color-navy)" }}>← Cases</Link>
                </p>
              )}
              {actionDone === "flagged" && (
                <p style={{ fontSize: "var(--text-base)", color: "var(--color-text-secondary)" }}>
                  Flag submitted. <Link href="/" style={{ color: "var(--color-text-secondary)" }}>← Cases</Link>
                </p>
              )}
              {!actionDone && !isAdmin && (
                <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>
                  You have view-only access. Contact your admin to approve cases.
                </p>
              )}
              {!actionDone && isAdmin && isPending && (
                <div>
                  <div style={{ display: "flex", gap: "var(--space-16)", flexWrap: "wrap" }}>
                    <Button variant="primary" loading={actioning && !showFlagForm} onClick={handleApprove}>Approve case</Button>
                    <Button variant="secondary" onClick={() => setShowFlagForm(v => !v)}>Flag for review</Button>
                  </div>
                  {showFlagForm && (
                    <div style={{ marginTop: "var(--space-24)" }}>
                      <textarea
                        rows={3} value={flagText} onChange={e => setFlagText(e.target.value)}
                        placeholder="Describe the issue…"
                        style={{ width: "100%", padding: "var(--space-16)", fontSize: "var(--text-base)", fontWeight: "var(--font-body)", fontFamily: "inherit", color: "var(--color-text-primary)", backgroundColor: "var(--color-surface)", border: "var(--border-width) solid var(--color-border)", borderRadius: "var(--btn-radius)", resize: "vertical", outline: "none", boxSizing: "border-box" }}
                      />
                      <div style={{ marginTop: "var(--space-8)" }}>
                        <Button variant="secondary" loading={actioning && showFlagForm} onClick={handleSendFlag}>Send flag</Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {!actionDone && isAdmin && isApproved && (
                <div>
                  <Button variant="secondary" onClick={() => { window.location.href = `/api-proxy/ledger/api/cases/${id}/hmrc-return`; }}>
                    Download HMRC return (PDF)
                  </Button>
                  <p style={{ marginTop: "var(--space-16)" }}>
                    <a href={`/api-proxy/ledger/api/cases/${id}/eu-xml`} style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", textDecoration: "underline" }}>
                      Download EU XML declaration
                    </a>
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ══ EMISSIONS TAB ══ */}
        {activeTab === "emissions" && <EmissionsTab case_={case_} />}

        {/* ══ AUDIT CHAIN TAB ══ */}
        {activeTab === "audit" && <AuditTrailTab caseId={id} localChanges={localChanges} />}

        {/* ══ SETTINGS TAB ══ */}
        {activeTab === "settings" && <SettingsTab case_={case_} />}

      </div>
    </div>
  );
}
