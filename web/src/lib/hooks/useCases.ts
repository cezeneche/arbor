"use client";

/**
 * lib/hooks/useCases.ts — React Query hooks for CBAM cases
 *
 * useCases(status?)   — list, refetches every 30 s
 * useCase(id)         — single case detail, refetches every 10 s
 * useReportPackage(id) — report package, cached 5 min (rarely changes)
 */

import { useQuery } from "@tanstack/react-query";
import { getCases, getCase, getReportPackage } from "@/lib/api/cases";
import type { Case, CaseDetail } from "@/lib/api/types";
import type { ReportPackage }    from "@/lib/types";

/* ── useCases ─────────────────────────────────────────────────────────────────── */

export interface UseCasesReturn {
  cases:     Case[];
  isLoading: boolean;
  error:     Error | null;
  refetch:   () => void;
}

export function useCases(status?: string): UseCasesReturn {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey:  ["cases", status ?? "all"],
    queryFn:   () => getCases(status),
    staleTime: 30_000,
    retry:     2,
  });

  return {
    cases:     data ?? [],
    isLoading,
    error:     error as Error | null,
    refetch,
  };
}

/* ── useCase ──────────────────────────────────────────────────────────────────── */

export interface UseCaseReturn {
  case_:     CaseDetail | undefined;
  isLoading: boolean;
  error:     Error | null;
  refetch:   () => void;
}

export function useCase(caseId: string | undefined): UseCaseReturn {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["case", caseId],
    queryFn:  () => getCase(caseId!),
    enabled:  Boolean(caseId),
    staleTime: 10_000,
    retry:    2,
  });

  return { case_: data, isLoading, error: error as Error | null, refetch };
}

/* ── useReportPackage ─────────────────────────────────────────────────────────── */

export interface UseReportPackageReturn {
  report:    ReportPackage | undefined;
  isLoading: boolean;
  error:     Error | null;
  refetch:   () => void;
}

export function useReportPackage(caseId: string | undefined): UseReportPackageReturn {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey:  ["report-package", caseId],
    queryFn:   () => getReportPackage(caseId!),
    enabled:   Boolean(caseId),
    staleTime: 5 * 60_000,   // 5 min — report packages are immutable once generated
    retry:     2,
  });

  return { report: data, isLoading, error: error as Error | null, refetch };
}
