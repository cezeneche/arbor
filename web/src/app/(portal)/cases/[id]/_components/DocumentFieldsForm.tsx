"use client";

// EU 2023/1773 Art. 4–6 / HMRC CBAM return fields. All 11 fields.
// Pre-filled from deterministic extraction; asterisk (*) marks missing fields.

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { patchCase } from "@/lib/api/cases";
import { sectorLabel } from "@/lib/constants";
import { SectionLabel } from "./shared";
import type { CaseDetail, RichGoodsLine } from "@/lib/api/types";
import type { CBAMShipment } from "@/lib/types";

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

export function DocumentFieldsForm({
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
