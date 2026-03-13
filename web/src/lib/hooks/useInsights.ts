"use client";

/**
 * lib/hooks/useInsights.ts — React Query hooks for CBAM sourcing insights
 *
 * useKPIs(eori, year, etsPriceEur?)      — portfolio KPIs, staleTime 2 min
 * useSupplierComparison(eori, cnCode)    — supplier ranking for a CN code
 * useCountryIntensity(eori)              — per-country intensity ranking
 * useSectorSummary(eori)                 — per-sector emissions summary
 *
 * All hooks are disabled when required params are missing.
 */

import { useQuery } from "@tanstack/react-query";
import {
  getKPIs,
  getSupplierComparison,
  getCountryIntensity,
  getSectorSummary,
} from "@/lib/api/insights";
import type {
  KPIs,
  SupplierRanking,
  CountryIntensity,
  SectorSummary,
} from "@/lib/api/types";

const STALE = 2 * 60_000; // 2 min — insights are aggregate, less volatile

/* ── useKPIs ──────────────────────────────────────────────────────────────────── */

export interface UseKPIsReturn {
  kpis:      KPIs | undefined;
  isLoading: boolean;
  error:     Error | null;
  refetch:   () => void;
}

export function useKPIs(
  eori:        string | undefined,
  year:        number | undefined,
  etsPriceEur?: number
): UseKPIsReturn {
  const enabled = Boolean(eori && year);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey:  ["kpis", eori, year, etsPriceEur],
    queryFn:   () => getKPIs(eori!, year!, etsPriceEur),
    enabled,
    staleTime: STALE,
    retry:     2,
  });

  return { kpis: data, isLoading, error: error as Error | null, refetch };
}

/* ── useSupplierComparison ────────────────────────────────────────────────────── */

export interface UseSupplierComparisonReturn {
  suppliers: SupplierRanking[];
  isLoading: boolean;
  error:     Error | null;
  refetch:   () => void;
}

export function useSupplierComparison(
  eori:   string | undefined,
  cnCode: string | undefined
): UseSupplierComparisonReturn {
  const enabled = Boolean(eori && cnCode);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey:  ["supplier-comparison", eori, cnCode],
    queryFn:   () => getSupplierComparison(eori!, cnCode!),
    enabled,
    staleTime: STALE,
    retry:     2,
  });

  return {
    suppliers: data ?? [],
    isLoading,
    error:     error as Error | null,
    refetch,
  };
}

/* ── useCountryIntensity ──────────────────────────────────────────────────────── */

export interface UseCountryIntensityReturn {
  countries: CountryIntensity[];
  isLoading: boolean;
  error:     Error | null;
  refetch:   () => void;
}

export function useCountryIntensity(
  eori: string | undefined
): UseCountryIntensityReturn {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey:  ["country-intensity", eori],
    queryFn:   () => getCountryIntensity(eori!),
    enabled:   Boolean(eori),
    staleTime: STALE,
    retry:     2,
  });

  return {
    countries: data ?? [],
    isLoading,
    error:     error as Error | null,
    refetch,
  };
}

/* ── useSectorSummary ─────────────────────────────────────────────────────────── */

export interface UseSectorSummaryReturn {
  sectors:   SectorSummary[];
  isLoading: boolean;
  error:     Error | null;
  refetch:   () => void;
}

export function useSectorSummary(
  eori: string | undefined
): UseSectorSummaryReturn {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey:  ["sector-summary", eori],
    queryFn:   () => getSectorSummary(eori!),
    enabled:   Boolean(eori),
    staleTime: STALE,
    retry:     2,
  });

  return {
    sectors:  data ?? [],
    isLoading,
    error:    error as Error | null,
    refetch,
  };
}
