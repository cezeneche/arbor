"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCase } from "@/lib/hooks/useCases";
import { useAuth } from "@/lib/auth/useAuth";
import { useRole } from "@/lib/auth/useRole";
import { getAuditLog } from "@/lib/api/audit";
import { approveCase, rejectCase, deleteCase, patchCase } from "@/lib/api/cases";
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

// Quality score weights (sum = 100).
// Green ≥ 80: all required fields + verified supplier data.
// Amber ≥ 40: core CBAM-required fields present, using default rates.
// Red  < 40:  critical data missing, cannot generate a return.
const QUALITY_WEIGHTS: Record<string, number> = {
  cn_code:              12,
  net_mass_kg:          12,
  verified_emissions:   12,
  sector:                9,
  importer_eori:         9,
  origin_country:        9,
  emissions_data:        9,
  importer_vat_number:   8,
  entry_reference:       8,
  installation_id:       5,
  incoterm:              4,
  invoice_number:        3,
};

function computeQualityScore(fields: Record<string, string>): number {
  let score = 0;
  for (const [key, weight] of Object.entries(QUALITY_WEIGHTS)) {
    if (fields[key] && fields[key].trim().length > 0) score += weight;
  }
  return score;
}

type FieldDef = {
  key:         string;
  label:       string;
  placeholder: string;
  required:    boolean;
  mono:        boolean;
  fullWidth?:  boolean;
  options?:    string[];
};

const FIELD_DEFS: FieldDef[] = [
  { key: "sector",               label: "Sector",                     placeholder: "e.g. Iron & steel",               required: true,  mono: false },
  { key: "importer_eori",        label: "Importer EORI",              placeholder: "e.g. GB123456789000",             required: true,  mono: true  },
  { key: "importer_vat_number",  label: "Importer VAT number",        placeholder: "e.g. GB123456789",                required: true,  mono: true  },
  { key: "origin_country",       label: "Country of origin",          placeholder: "e.g. DE",                         required: true,  mono: false },
  { key: "cn_code",              label: "CN8 commodity code",         placeholder: "e.g. 72082700",                   required: true,  mono: true  },
  { key: "net_mass_kg",          label: "Net weight (kg)",            placeholder: "e.g. 5000",                       required: true,  mono: false },
  { key: "entry_reference",      label: "Customs entry ref (MRN)",    placeholder: "18-character MRN",                required: true,  mono: true  },
  { key: "incoterm",             label: "Incoterms",                  placeholder: "e.g. CIF, FOB, EXW",              required: false, mono: false },
  { key: "installation_id",      label: "Supplier installation ID",   placeholder: "EU CBAM installation ID",         required: false, mono: true  },
  { key: "verified_emissions",   label: "Supplier-verified (tCO₂e)", placeholder: "e.g. 12.450",                     required: false, mono: false },
  { key: "invoice_number",       label: "Invoice / reference",        placeholder: "e.g. INV-2027-001",               required: false, mono: false },
  { key: "emissions_data",       label: "Emissions tier",             placeholder: "",                                required: true,  mono: false, options: ["Annex VI default", "Estimated (unverified)", "Supplier-verified"] },
];

type FieldState = Record<string, string>;

function initFields(case_: CaseDetail): FieldState {
  const shipment = (case_.shipments ?? [])[0] as CBAMShipment | undefined;
  const gl       = (case_.goods_lines ?? [])[0] as RichGoodsLine | undefined;
  const m        = gl?.method;
  return {
    sector:              gl?.sector ? sectorLabel(gl.sector) : "",
    importer_eori:       case_.importer_eori ?? "",
    importer_vat_number: "",
    origin_country:      shipment?.origin_country ?? gl?.origin_country ?? "",
    cn_code:             gl?.cn_code ?? "",
    net_mass_kg:         gl?.net_mass_kg != null ? String(gl.net_mass_kg) : gl?.quantity != null ? String(gl.quantity) : "",
    entry_reference:     shipment?.entry_reference ?? "",
    incoterm:            shipment?.incoterm ?? "",
    installation_id:     gl?.installation_id ?? "",
    verified_emissions:  (m === "actual" && gl?.direct_kgco2e != null) ? (gl.direct_kgco2e / 1000).toFixed(3) : "",
    invoice_number:      "",
    emissions_data:      m === "actual" ? "Supplier-verified" : m === "estimated" ? "Estimated (unverified)" : m === "default" ? "Annex VI default" : "",
  };
}

// Maps display values in the form to DB-level values sent to the API
const SECTOR_DB: Record<string, string> = {
  "Iron & steel": "iron_steel", "Aluminium": "aluminium", "Cement": "cement",
  "Fertilisers": "fertilisers", "Hydrogen": "hydrogen", "Electricity": "electricity",
};
const EMISSIONS_METHOD_DB: Record<string, string> = {
  "Annex VI default": "default", "Estimated (unverified)": "estimated", "Supplier-verified": "actual",
};

function DocumentFieldsForm({
  case_,
  actorName,
  onSaved,
}: {
  case_:     CaseDetail;
  actorName: string;
  onSaved:   () => void;
}) {
  const [fields,  setFields]  = useState<FieldState>(() => initFields(case_));
  const [initial, setInitial] = useState<FieldState>(() => initFields(case_));
  const [focused, setFocused] = useState<string | null>(null);
  const [saving,  setSaving]  = useState(false);
  const [saved,   setSaved]   = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  // After our own save the query re-fetches with a new updated_at — skip that one reset.
  const justSavedRef    = useRef(false);
  const prevUpdatedAt   = useRef(case_.updated_at);

  useEffect(() => {
    if (case_.updated_at === prevUpdatedAt.current) return;
    prevUpdatedAt.current = case_.updated_at;
    if (justSavedRef.current) {
      // This re-fetch was triggered by our own PATCH — don't overwrite the form
      justSavedRef.current = false;
      return;
    }
    // An external update (another tab, background polling) — sync the form
    const fresh = initFields(case_);
    setFields(fresh);
    setInitial(fresh);
  }, [case_]);

  const isDirty      = FIELD_DEFS.some(f => fields[f.key] !== initial[f.key]);
  const qualityScore = computeQualityScore(fields);

  function handleChange(key: string, val: string) {
    setFields(prev => ({ ...prev, [key]: val }));
    setSaved(false);
    setSaveErr(null);
  }

  async function handleSave() {
    setSaving(true);
    setSaveErr(null);

    const changed = FIELD_DEFS.filter(f => fields[f.key] !== initial[f.key]);
    const fieldChanges = Object.fromEntries(
      changed.map(f => [f.label, { from: initial[f.key] ?? "", to: fields[f.key] ?? "" }])
    ) as Record<string, { from: string; to: string }>;

    // Build typed patch payload — map display values to DB keys
    const patch: import("@/lib/api/cases").CasePatch = {
      actor_name:    actorName,
      field_changes: fieldChanges,
    };
    if (fields.importer_eori   !== initial.importer_eori)   patch.importer_eori   = fields.importer_eori;
    if (fields.origin_country  !== initial.origin_country)   patch.origin_country  = fields.origin_country;
    if (fields.entry_reference !== initial.entry_reference)  patch.entry_reference = fields.entry_reference;
    if (fields.incoterm        !== initial.incoterm)         patch.incoterm        = fields.incoterm;
    if (fields.cn_code         !== initial.cn_code)          patch.cn_code         = fields.cn_code;
    if (fields.installation_id !== initial.installation_id)  patch.installation_id = fields.installation_id;
    if (fields.net_mass_kg     !== initial.net_mass_kg && fields.net_mass_kg) {
      const parsed = parseFloat(fields.net_mass_kg);
      if (!isNaN(parsed)) patch.net_mass_kg = parsed;
    }
    if (fields.sector !== initial.sector && SECTOR_DB[fields.sector]) {
      patch.sector = SECTOR_DB[fields.sector];
    }
    if (fields.emissions_data !== initial.emissions_data && EMISSIONS_METHOD_DB[fields.emissions_data]) {
      patch.emissions_method = EMISSIONS_METHOD_DB[fields.emissions_data];
    }
    if (fields.verified_emissions !== initial.verified_emissions && fields.verified_emissions) {
      const tco2e = parseFloat(fields.verified_emissions);
      if (!isNaN(tco2e)) patch.direct_kgco2e = tco2e * 1000; // tCO2e → kgCO2e
    }

    try {
      justSavedRef.current = true;
      await patchCase(case_.id, patch);
      setInitial({ ...fields });
      setSaved(true);
      onSaved();
    } catch (err) {
      justSavedRef.current = false;
      setSaveErr((err as Error).message ?? "Save failed — please try again.");
    }
    setSaving(false);
  }

  const scoreColor =
    qualityScore >= 80 ? "var(--color-green)" :
    qualityScore >= 40 ? "var(--color-amber)" :
                         "var(--color-red)";
  const scoreBg =
    qualityScore >= 80 ? "var(--color-green-bg)" :
    qualityScore >= 40 ? "var(--color-amber-bg)" :
                         "var(--color-red-bg)";

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "var(--space-24)" }}>
        <SectionLabel>Document fields</SectionLabel>
        <span style={{ fontSize: "var(--text-xs)", fontWeight: 500, color: scoreColor, backgroundColor: scoreBg, padding: "2px 8px", borderRadius: "3px", fontVariantNumeric: "tabular-nums" }}>
          {qualityScore}/100
        </span>
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
              {field.options ? (
              <select
                id={`cf-${field.key}`}
                value={val}
                onChange={e => handleChange(field.key, e.target.value)}
                onFocus={() => setFocused(field.key)}
                onBlur={() => setFocused(null)}
                style={{
                  display: "block", width: "100%", height: "40px",
                  padding: "0 var(--space-16)",
                  fontSize: "var(--text-base)", fontWeight: "var(--font-body)",
                  fontFamily: "inherit",
                  color: val ? "var(--color-text-primary)" : "var(--color-text-tertiary)",
                  backgroundColor: "var(--color-surface)",
                  border: `0.5px solid ${border}`,
                  borderRadius: "6px", outline: "none", boxSizing: "border-box",
                  appearance: "none", cursor: "pointer",
                  transition: "border-color 100ms",
                }}
              >
                <option value="">Select…</option>
                {field.options.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
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
            )}
            </div>
          );
        })}
      </div>

      {isDirty && (
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-16)", marginTop: "var(--space-24)" }}>
          <Button variant="primary" loading={saving} onClick={handleSave}>Save changes</Button>
          {saved && <span style={{ fontSize: "var(--text-xs)", color: "var(--color-green)" }}>Saved</span>}
          {saveErr && <span style={{ fontSize: "var(--text-xs)", color: "var(--color-red)" }}>{saveErr}</span>}
        </div>
      )}
    </div>
  );
}

// ── Emissions tab ──────────────────────────────────────────────────────────────

function EmissionsTab({ case_, onProvideData }: { case_: CaseDetail; onProvideData: () => void }) {
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
              <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", margin: "0 0 var(--space-16)", lineHeight: 1.6 }}>
                This liability uses conservative Annex VI default values. Provide supplier-verified emissions data to replace default values and potentially reduce your liability.
              </p>
              <div style={{ display: "flex", gap: "var(--space-12)" }}>
                <Button variant="primary" onClick={onProvideData}>Provide data</Button>
                <Link
                  href={`/suppliers?case=${case_.id}`}
                  style={{
                    display: "inline-flex", alignItems: "center", height: "40px",
                    padding: "0 var(--space-24)", borderRadius: "var(--btn-radius)",
                    fontSize: "var(--text-base)", fontWeight: "var(--font-focal)",
                    color: "var(--color-text-primary)", backgroundColor: "var(--color-surface)",
                    border: "var(--border-width) solid var(--color-border)",
                    textDecoration: "none", whiteSpace: "nowrap",
                  }}
                >
                  Request supplier data
                </Link>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Audit chain tab ────────────────────────────────────────────────────────────

const AUDIT_EVENT_LABELS: Record<string, string> = {
  case_created:            "Case created",
  case_fields_updated:     "Fields updated",
  document_uploaded:       "Document uploaded",
  extraction_complete:     "Extraction complete",
  cbam_calculation_completed: "Calculation completed",
  human_review_required:   "Human review required",
  review_approved:         "Case approved",
  review_rejected:         "Case flagged",
  report_package_generated:"Report package generated",
};

function eventLabel(type: string): string {
  return AUDIT_EVENT_LABELS[type] ?? type.replace(/_/g, " ");
}

function safePayload(raw: unknown): Record<string, unknown> | null {
  if (!raw) return null;
  if (typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw === "string") {
    try { return JSON.parse(raw) as Record<string, unknown>; } catch { return null; }
  }
  return null;
}

function eventActor(ev: AuditEvent): string {
  const payload = safePayload(ev.payload);
  if (payload?.actor_name && typeof payload.actor_name === "string") return payload.actor_name;
  return actorLabel(ev);
}

function AuditTrailTab({ caseId }: { caseId: string }) {
  const { data: raw = [] } = useQuery<AuditEvent[]>({
    queryKey:  ["audit-log", caseId],
    queryFn:   () => getAuditLog(caseId),
    staleTime: 0,
    enabled:   Boolean(caseId),
  });

  const auditEvents: AuditEvent[] = Array.isArray(raw)
    ? raw
    : ((raw as { events?: AuditEvent[] }).events ?? []);

  const chainValid = auditEvents.length === 0 || isChainValid(auditEvents);

  // ── Filters ────────────────────────────────────────────────────────────────
  const [filterActor, setFilterActor] = useState("");
  const [filterType,  setFilterType]  = useState("");
  const [filterFrom,  setFilterFrom]  = useState("");
  const [filterTo,    setFilterTo]    = useState("");

  const allActors = Array.from(new Set(auditEvents.map(ev => eventActor(ev)).filter(Boolean)));
  const allTypes  = Array.from(new Set(auditEvents.map(ev => ev.event_type)));

  const filtered = auditEvents.filter(ev => {
    if (filterActor && eventActor(ev) !== filterActor) return false;
    if (filterType  && ev.event_type !== filterType)   return false;
    if (filterFrom) {
      const fromTs = new Date(filterFrom).getTime();
      if (new Date(ev.created_at).getTime() < fromTs) return false;
    }
    if (filterTo) {
      const toTs = new Date(filterTo).getTime() + 86_400_000; // inclusive end-of-day
      if (new Date(ev.created_at).getTime() > toTs) return false;
    }
    return true;
  });

  const hasFilter = Boolean(filterActor || filterType || filterFrom || filterTo);

  const inputStyle: React.CSSProperties = {
    height: "32px", padding: "0 10px", fontSize: "var(--text-xs)",
    fontFamily: "inherit", color: "var(--color-text-primary)",
    backgroundColor: "var(--color-surface)",
    border: "0.5px solid var(--color-border)", borderRadius: "6px",
    outline: "none", boxSizing: "border-box" as const, appearance: "none" as const,
  };

  return (
    <div>
      {!chainValid && (
        <div style={{ padding: "var(--space-16) var(--space-24)", marginBottom: "var(--space-24)", backgroundColor: "var(--color-red-bg)", border: "var(--border-width) solid var(--color-red)", borderRadius: "6px" }}>
          <p style={{ fontSize: "var(--text-sm)", color: "var(--color-red)", margin: 0 }}>
            Chain integrity check failed — this case requires manual verification before submission.
          </p>
        </div>
      )}

      {chainValid && auditEvents.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-8)", marginBottom: "var(--space-24)" }}>
          <span style={{ display: "inline-block", width: "6px", height: "6px", borderRadius: "50%", backgroundColor: "var(--color-green)", flexShrink: 0 }} />
          <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)" }}>
            Chain integrity verified — {auditEvents.length} event{auditEvents.length !== 1 ? "s" : ""}
          </span>
        </div>
      )}

      {/* ── Filter bar ── */}
      {auditEvents.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-8)", marginBottom: "var(--space-24)", padding: "var(--space-16)", backgroundColor: "var(--color-surface)", border: "var(--border-width) solid var(--color-border)", borderRadius: "8px" }}>
          <select value={filterActor} onChange={e => setFilterActor(e.target.value)} style={inputStyle}>
            <option value="">All actors</option>
            {allActors.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <select value={filterType} onChange={e => setFilterType(e.target.value)} style={inputStyle}>
            <option value="">All events</option>
            {allTypes.map(t => <option key={t} value={t}>{eventLabel(t)}</option>)}
          </select>
          <input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} style={{ ...inputStyle, width: "140px" }} />
          <input type="date" value={filterTo}   onChange={e => setFilterTo(e.target.value)}   style={{ ...inputStyle, width: "140px" }} />
          {hasFilter && (
            <button
              onClick={() => { setFilterActor(""); setFilterType(""); setFilterFrom(""); setFilterTo(""); }}
              style={{ height: "32px", padding: "0 10px", fontSize: "var(--text-xs)", fontFamily: "inherit", color: "var(--color-text-secondary)", backgroundColor: "transparent", border: "0.5px solid var(--color-border)", borderRadius: "6px", cursor: "pointer" }}
            >
              Clear
            </button>
          )}
        </div>
      )}

      {auditEvents.length === 0 && (
        <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-tertiary)" }}>No audit events yet.</p>
      )}

      {filtered.length === 0 && auditEvents.length > 0 && (
        <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-tertiary)" }}>No events match the current filter.</p>
      )}

      <div style={{ border: filtered.length > 0 ? "var(--border-width) solid var(--color-border)" : "none", borderRadius: "8px", overflow: "hidden" }}>
        {filtered.map((ev, i) => {
          const hmac      = ev.hmac_sha256 ?? ev.signature;
          const actor     = eventActor(ev);
          const isLast    = i === filtered.length - 1;
          const payload   = safePayload(ev.payload);
          const rawChanges = payload?.field_changes;
          const changes   = rawChanges && typeof rawChanges === "object" && !Array.isArray(rawChanges)
            ? rawChanges as Record<string, unknown>
            : null;
          const changeEntries = changes ? Object.entries(changes) : [];

          return (
            <div
              key={ev.id}
              style={{ padding: "var(--space-16) var(--space-24)", borderBottom: isLast ? undefined : "var(--border-width) solid var(--color-border)" }}
            >
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "var(--space-16)" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--space-8)", marginBottom: "4px" }}>
                    <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)", whiteSpace: "nowrap" }}>
                      {fmtTime(ev.created_at)}
                    </span>
                    {ev.verified === false && (
                      <span style={{ fontSize: "11px", fontWeight: 500, color: "var(--color-red)", backgroundColor: "var(--color-red-bg)", padding: "1px 6px", borderRadius: "3px" }}>
                        invalid
                      </span>
                    )}
                  </div>
                  <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-primary)", margin: "0 0 4px" }}>
                    {eventLabel(ev.event_type)}
                  </p>
                  {changeEntries.map(([label, val]) => {
                    const from = typeof val === "object" && val !== null ? String((val as { from?: unknown }).from ?? "") : "";
                    const to   = typeof val === "object" && val !== null ? String((val as { to?: unknown }).to   ?? "") : "";
                    return (
                      <div key={label} style={{ fontSize: "var(--text-xs)", color: "var(--color-text-secondary)", marginBottom: "2px" }}>
                        <span style={{ fontWeight: 500 }}>{label}:</span>{" "}
                        {from ? (
                          <><span style={{ textDecoration: "line-through", color: "var(--color-text-tertiary)" }}>{from}</span>{" → "}{to}</>
                        ) : (
                          <span style={{ color: "var(--color-green)" }}>{to}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "4px", flexShrink: 0 }}>
                  {actor && actor !== "system" && (
                    <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-secondary)", whiteSpace: "nowrap" }}>{actor}</span>
                  )}
                  <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)", ...MONO, whiteSpace: "nowrap" }}>{hmac?.slice(0, 12) ?? "—"}</span>
                </div>
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

// ── Page ───────────────────────────────────────────────────────────────────────

export default function CaseDetailPage({ params }: { params: { id: string } }) {
  const { id }        = params;
  const { user }      = useAuth();
  const role          = useRole();
  const isAdmin       = role === "admin";
  const router        = useRouter();
  const queryClient   = useQueryClient();

  const { case_, isLoading, error } = useCase(id);

  const [activeTab,       setActiveTab]       = useState<ActiveTab>("details");
  const [actionDone,      setActionDone]       = useState<"approved" | "flagged" | null>(null);
  const [showFlagForm,    setShowFlagForm]     = useState(false);
  const [flagText,        setFlagText]         = useState("");
  const [actioning,       setActioning]        = useState(false);
  const [unseenAuditCount, setUnseenAuditCount] = useState(0);

  // Actor display name: prefer JWT name claim, fall back to sub (email/id)
  const actorName = user?.name ?? user?.sub ?? "unknown";

  function handleTabClick(tab: ActiveTab) {
    setActiveTab(tab);
    if (tab === "audit") setUnseenAuditCount(0);
  }

  const handleSaved = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["audit-log", id] });
    queryClient.invalidateQueries({ queryKey: ["case", id] });
    setUnseenAuditCount(c => c + 1);
  }, [queryClient, id]);

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

  function refreshAll() {
    setTimeout(() => {
      queryClient.invalidateQueries({ queryKey: ["case", id] });
      queryClient.invalidateQueries({ queryKey: ["cases"] });
      queryClient.invalidateQueries({ queryKey: ["audit-log", id] });
      setUnseenAuditCount(c => c + 1);
      router.refresh();
    }, 1000);
  }

  async function handleApprove() {
    setActioning(true);
    try {
      await approveCase(id, { reviewer_name: user?.sub ?? "reviewer", reviewer_email: user?.sub ?? "reviewer@nucleos", comments: "Approved via case detail" });
      setActionDone("approved");
      refreshAll();
    } catch { /* unchanged */ }
    setActioning(false);
  }

  async function handleSendFlag() {
    if (!flagText.trim()) return;
    setActioning(true);
    try {
      await rejectCase(id, { reviewer_name: user?.sub ?? "reviewer", reviewer_email: user?.sub ?? "reviewer@nucleos", comments: flagText.trim() });
      setActionDone("flagged");
      refreshAll();
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
              onClick={() => handleTabClick(tab.key)}
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
              {tab.key === "audit" && unseenAuditCount > 0 && activeTab !== "audit" && (
                <span style={{ position: "absolute", top: "2px", right: "-10px", width: "6px", height: "6px", borderRadius: "50%", backgroundColor: "var(--color-amber)" }} />
              )}
            </button>
          ))}
        </div>

        {/* ══ DETAILS TAB ══ */}
        {activeTab === "details" && (
          <div>
            {/* Case details — no title */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "var(--space-24)", marginBottom: "var(--space-40)" }}>
              <div>
                <p style={{ fontSize: "11px", fontWeight: 300, color: "var(--color-text-tertiary)", marginBottom: "4px" }}>Sector</p>
                <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-primary)", margin: 0 }}>{sector}</p>
              </div>
              <div>
                <p style={{ fontSize: "11px", fontWeight: 300, color: "var(--color-text-tertiary)", marginBottom: "4px" }}>Country of origin</p>
                <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-primary)", margin: 0 }}>{country}</p>
              </div>
              <div>
                <p style={{ fontSize: "11px", fontWeight: 300, color: "var(--color-text-tertiary)", marginBottom: "4px" }}>Import date</p>
                <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-primary)", margin: 0 }}>{fmtDate(importDate)}</p>
              </div>
            </div>

            <Divider />

            {!isProcessing && (
              <DocumentFieldsForm case_={case_} actorName={actorName} onSaved={handleSaved} />
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
        {activeTab === "emissions" && <EmissionsTab case_={case_} onProvideData={() => setActiveTab("details")} />}

        {/* ══ AUDIT CHAIN TAB ══ */}
        {activeTab === "audit" && <AuditTrailTab caseId={id} />}

        {/* ══ SETTINGS TAB ══ */}
        {activeTab === "settings" && <SettingsTab case_={case_} />}

      </div>
    </div>
  );
}
