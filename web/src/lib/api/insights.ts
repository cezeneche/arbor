/**
 * lib/api/insights.ts — Sourcing intelligence API
 *
 * Backend routes (proxied through /api-proxy/ledger):
 *   GET /api/cbam/insights/kpis               ?importer_eori= &reporting_year=
 *   GET /api/cbam/insights/supplier-comparison?importer_eori= &cn_code=
 *   GET /api/cbam/insights/country-intensity  ?importer_eori=
 *   GET /api/cbam/insights/sector-summary     ?importer_eori=
 *
 * All endpoints accept an optional eu_ets_price_eur for cost sensitivity.
 */

import { ledgerFetch } from "./client";
import type {
  KPIs,
  SupplierRanking,
  CountryIntensity,
  SectorSummary,
} from "./types";

function qs(params: Record<string, string | number | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

/* ── KPIs ─────────────────────────────────────────────────────────────────────── */

export function getKPIs(
  eori:          string,
  year:          number,
  etsPriceEur?:  number
): Promise<KPIs> {
  return ledgerFetch<KPIs>(
    `/api/cbam/insights/kpis${qs({
      importer_eori: eori,
      reporting_year: year,
      ...(etsPriceEur !== undefined ? { eu_ets_price_eur: etsPriceEur } : {}),
    })}`
  );
}

/* ── Supplier comparison ──────────────────────────────────────────────────────── */

export function getSupplierComparison(
  eori:   string,
  cnCode: string
): Promise<SupplierRanking[]> {
  return ledgerFetch<SupplierRanking[]>(
    `/api/cbam/insights/supplier-comparison${qs({
      importer_eori: eori,
      cn_code:       cnCode,
    })}`
  );
}

/* ── Country intensity ────────────────────────────────────────────────────────── */

export function getCountryIntensity(eori: string): Promise<CountryIntensity[]> {
  return ledgerFetch<CountryIntensity[]>(
    `/api/cbam/insights/country-intensity${qs({ importer_eori: eori })}`
  );
}

/* ── Sector summary ───────────────────────────────────────────────────────────── */

export function getSectorSummary(eori: string): Promise<SectorSummary[]> {
  return ledgerFetch<SectorSummary[]>(
    `/api/cbam/insights/sector-summary${qs({ importer_eori: eori })}`
  );
}
