"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatCurrency, methodLabel, methodBadgeVariant } from "@/lib/design-system";
import { sectorLabel } from "@/lib/constants";
import { UK_CBAM_RATES, ROUGH_SEE, MONO, Divider, fmtMass } from "./shared";
import type { CaseDetail, RichGoodsLine } from "@/lib/api/types";

export function EmissionsTab({ case_, onProvideData }: { case_: CaseDetail; onProvideData: () => void }) {
  const goods_lines = (case_.goods_lines ?? []) as RichGoodsLine[];

  if (goods_lines.length === 0) {
    return (
      <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-tertiary)" }}>
        No goods lines yet. Upload a supplier document to calculate emissions.
      </p>
    );
  }

  const totalDirectKgco2e = goods_lines.reduce((sum, gl) => {
    const kg       = gl.net_mass_kg ?? gl.quantity ?? 0;
    const see      = ROUGH_SEE[gl.sector ?? ""] ?? 1.5;
    const directKg = gl.direct_kgco2e ?? (kg > 0 ? (kg / 1000) * see * 1000 : 0);
    return sum + directKg;
  }, 0);

  const cbamCharge = goods_lines.reduce((sum, gl) => {
    const kg       = gl.net_mass_kg ?? gl.quantity ?? 0;
    const see      = ROUGH_SEE[gl.sector ?? ""] ?? 1.5;
    const directKg = gl.direct_kgco2e ?? (kg > 0 ? (kg / 1000) * see * 1000 : 0);
    const rate     = UK_CBAM_RATES[gl.sector ?? ""] ?? UK_CBAM_RATES["iron_steel"];
    return sum + (directKg / 1000) * rate;
  }, 0);
  const isAnyDefault = goods_lines.some(gl => !gl.method || gl.method === "default");

  return (
    <div>
      {/* Per-line calculations */}
      {goods_lines.map((gl, i) => {
        const kg       = gl.net_mass_kg ?? gl.quantity ?? 0;
        const see      = ROUGH_SEE[gl.sector ?? ""] ?? 1.5;
        const directKg = gl.direct_kgco2e ?? (kg > 0 ? (kg / 1000) * see * 1000 : 0);
        const directT  = directKg / 1000;
        const rate     = UK_CBAM_RATES[gl.sector ?? ""] ?? UK_CBAM_RATES["iron_steel"];
        const charge   = directT * rate;
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

            <div style={{ backgroundColor: "var(--color-bg)", border: "var(--border-width) solid var(--color-border)", borderRadius: "6px", padding: "var(--space-16)", marginBottom: "var(--space-16)" }}>
              <p style={{ fontSize: "11px", fontWeight: 300, color: "var(--color-text-tertiary)", marginBottom: "8px" }}>CBAM calculation</p>
              <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", margin: "0 0 4px", fontVariantNumeric: "tabular-nums" }}>
                {directT.toFixed(3)} tCO₂e × £{rate.toFixed(2)}/tCO₂e
                {" = "}
                <span style={{ fontWeight: 500, color: "var(--color-navy)" }}>{formatCurrency(charge)}</span>
              </p>
              <p style={{ fontSize: "11px", fontWeight: 300, color: "var(--color-text-tertiary)", margin: 0 }}>
                UK CBAM rate: £{rate.toFixed(2)}/tCO₂e (ETS price × (1 − free allocation), Q1 2027 placeholder)
              </p>
            </div>

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
