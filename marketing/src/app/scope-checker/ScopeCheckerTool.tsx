"use client";

import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type Regime = "UK" | "EU" | "BOTH";

interface CnSuggestion {
  cn8_code: string;
  sector: string;
  description: string;
  default_see_tco2e_per_t: number;
}

interface ScopeResult {
  in_scope: boolean;
  regime: Regime;
  sector: string | null;
  cn_description: string | null;
  registration_required: boolean;
  approaching_threshold?: boolean;
  reason: string;
  first_return_due: string | null;
  default_see_tco2e_per_t: number | null;
  next_steps: string[];
}

interface LiabilityResult {
  total_embedded_tco2e: number;
  gross_cbam_liability_gbp: number;
  cbam_rate_gbp_per_tco2e: number;
  emissions_intensity_tco2e_per_t: number;
  if_actual_data_saving_gbp: number;
  annual_subscription_comparison: {
    professional_tier_gbp: number;
    as_percentage_of_liability: string;
    message: string;
  } | null;
  disclaimer: string;
}

function formatGBP(n: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(n);
}

function sectorLabel(s: string): string {
  const m: Record<string, string> = {
    iron_steel: "Iron & Steel",
    aluminium: "Aluminium",
    cement: "Cement",
    fertilisers: "Fertilisers",
    hydrogen: "Hydrogen",
    electricity: "Electricity",
  };
  return m[s] ?? s;
}

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs rounded-badge px-3 py-1.5"
      style={{
        fontWeight: 500,
        backgroundColor: ok ? "var(--color-green-bg)" : "var(--color-red-bg)",
        color: ok ? "var(--color-green)" : "var(--color-red)",
      }}
    >
      {ok ? "✓" : "✕"} {label}
    </span>
  );
}

export function ScopeCheckerTool() {
  const [cnCode, setCnCode] = useState("");
  const [importValue, setImportValue] = useState("");
  const [importTonnes, setImportTonnes] = useState("");
  const [regime, setRegime] = useState<Regime>("UK");
  const [suggestions, setSuggestions] = useState<CnSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const [loading, setLoading] = useState(false);
  const [scopeResult, setScopeResult] = useState<ScopeResult | null>(null);
  const [liabilityResult, setLiabilityResult] = useState<LiabilityResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const suggestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchSuggestions = useCallback(async (q: string) => {
    const digits = q.replace(/\D/g, "");
    if (digits.length < 2) {
      setSuggestions([]);
      return;
    }
    try {
      const res = await fetch(
        `${API_URL}/api/public/cbam-cn-lookup?q=${digits}`,
      );
      if (!res.ok) return;
      const data = await res.json();
      setSuggestions(data.results ?? []);
      setShowSuggestions(true);
    } catch {
      // silently ignore autocomplete failures
    }
  }, []);

  function handleCnChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    setCnCode(v);
    if (suggestTimer.current) clearTimeout(suggestTimer.current);
    suggestTimer.current = setTimeout(() => fetchSuggestions(v), 300);
  }

  function selectSuggestion(s: CnSuggestion) {
    setCnCode(s.cn8_code);
    setSuggestions([]);
    setShowSuggestions(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setScopeResult(null);
    setLiabilityResult(null);
    setShowSuggestions(false);

    const digits = cnCode.replace(/\D/g, "");
    if (digits.length < 2) {
      setError("Enter at least the first 2 digits of your CN code.");
      return;
    }
    const value = parseFloat(importValue.replace(/[^0-9.]/g, ""));
    if (isNaN(value) || value < 0) {
      setError("Enter a valid annual import value in GBP.");
      return;
    }

    setLoading(true);
    try {
      const tonnes = parseFloat(importTonnes.replace(/[^0-9.]/g, ""));
      const scopeBody: Record<string, unknown> = {
        cn8_code: digits,
        annual_import_value_gbp: value,
        regime,
      };
      if (!isNaN(tonnes) && tonnes > 0) {
        scopeBody.annual_import_tonnes = tonnes;
      }

      const scopeRes = await fetch(`${API_URL}/api/public/cbam-scope-check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(scopeBody),
      });
      if (!scopeRes.ok) {
        const detail = await scopeRes.json().catch(() => ({}));
        throw new Error(detail.detail ?? "Scope check failed. Please try again.");
      }
      const scope: ScopeResult = await scopeRes.json();
      setScopeResult(scope);

      if (scope.in_scope && !isNaN(tonnes) && tonnes > 0) {
        const liabRes = await fetch(
          `${API_URL}/api/public/cbam-liability-estimate`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              cn8_code: digits,
              annual_import_tonnes: tonnes,
              regime,
              emissions_method: "default",
            }),
          },
        );
        if (liabRes.ok) {
          setLiabilityResult(await liabRes.json());
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setScopeResult(null);
    setLiabilityResult(null);
    setError(null);
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
      {/* Form */}
      <div
        className="bg-surface rounded-card p-8"
        style={{ border: "0.5px solid var(--color-border)", boxShadow: "var(--card-shadow)" }}
      >
        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
          {/* CN Code */}
          <div className="relative">
            <label
              htmlFor="cn-code"
              className="block text-xs text-text-secondary mb-2"
              style={{ fontWeight: 500 }}
            >
              CN commodity code
            </label>
            <input
              id="cn-code"
              type="text"
              inputMode="numeric"
              placeholder="e.g. 7208 10 00"
              value={cnCode}
              onChange={handleCnChange}
              onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
              className="w-full rounded-input text-text-primary text-base bg-bg"
              style={{
                height: "var(--input-height)",
                border: "0.5px solid var(--color-border)",
                paddingLeft: "var(--space-16)",
                paddingRight: "var(--space-16)",
                fontWeight: "var(--font-body)",
                outline: "none",
              }}
              autoComplete="off"
            />
            <p className="text-xs text-text-tertiary mt-2">
              Enter 2–8 digits. We&apos;ll match to the closest in-scope code.
            </p>

            {/* Autocomplete dropdown */}
            {showSuggestions && suggestions.length > 0 && (
              <div
                className="absolute z-10 w-full top-full mt-1 bg-surface rounded-card overflow-hidden"
                style={{
                  border: "0.5px solid var(--color-border)",
                  boxShadow: "var(--card-shadow)",
                }}
              >
                {suggestions.map((s) => (
                  <button
                    key={s.cn8_code}
                    type="button"
                    onMouseDown={() => selectSuggestion(s)}
                    className="w-full text-left px-4 py-3 hover:bg-bg transition-colors"
                    style={{ borderBottom: "0.5px solid var(--color-border)" }}
                  >
                    <p className="text-sm text-text-primary" style={{ fontWeight: 500 }}>
                      {s.cn8_code}
                    </p>
                    <p className="text-xs text-text-secondary truncate">{s.description}</p>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Import value */}
          <div>
            <label
              htmlFor="import-value"
              className="block text-xs text-text-secondary mb-2"
              style={{ fontWeight: 500 }}
            >
              Estimated annual import value (GBP)
            </label>
            <div className="relative">
              <span
                className="absolute left-4 top-1/2 -translate-y-1/2 text-sm text-text-tertiary"
                aria-hidden
              >
                £
              </span>
              <input
                id="import-value"
                type="text"
                inputMode="numeric"
                placeholder="e.g. 250000"
                value={importValue}
                onChange={(e) => setImportValue(e.target.value)}
                className="w-full rounded-input text-text-primary text-base bg-bg"
                style={{
                  height: "var(--input-height)",
                  border: "0.5px solid var(--color-border)",
                  paddingLeft: "32px",
                  paddingRight: "var(--space-16)",
                  fontWeight: "var(--font-body)",
                  outline: "none",
                }}
              />
            </div>
            <p className="text-xs text-text-tertiary mt-2">
              UK threshold: £50,000 rolling 12-month window.
            </p>
          </div>

          {/* Import tonnes (optional, for liability) */}
          <div>
            <label
              htmlFor="import-tonnes"
              className="block text-xs text-text-secondary mb-2"
              style={{ fontWeight: 500 }}
            >
              Estimated annual import weight (tonnes){" "}
              <span className="text-text-tertiary" style={{ fontWeight: 300 }}>
                (optional, for liability estimate)
              </span>
            </label>
            <div className="relative">
              <input
                id="import-tonnes"
                type="text"
                inputMode="decimal"
                placeholder="e.g. 500"
                value={importTonnes}
                onChange={(e) => setImportTonnes(e.target.value)}
                className="w-full rounded-input text-text-primary text-base bg-bg"
                style={{
                  height: "var(--input-height)",
                  border: "0.5px solid var(--color-border)",
                  paddingLeft: "var(--space-16)",
                  paddingRight: "52px",
                  fontWeight: "var(--font-body)",
                  outline: "none",
                }}
              />
              <span
                className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-text-tertiary"
                aria-hidden
              >
                t
              </span>
            </div>
          </div>

          {/* Regime */}
          <div>
            <p
              className="text-xs text-text-secondary mb-2"
              style={{ fontWeight: 500 }}
            >
              Regime
            </p>
            <div className="flex gap-2">
              {(["UK", "EU", "BOTH"] as Regime[]).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRegime(r)}
                  className={cn(
                    "flex-1 text-sm rounded-btn transition-colors",
                    "border",
                  )}
                  style={{
                    height: "var(--btn-height)",
                    fontWeight: regime === r ? 500 : 300,
                    backgroundColor:
                      regime === r ? "var(--color-navy)" : "var(--color-surface)",
                    color:
                      regime === r ? "var(--color-surface)" : "var(--color-text-secondary)",
                    borderColor:
                      regime === r ? "var(--color-navy)" : "var(--color-border)",
                  }}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <p className="text-sm text-red" style={{ lineHeight: 1.5 }}>
              {error}
            </p>
          )}

          <Button type="submit" variant="primary" disabled={loading}>
            {loading ? "Checking…" : "Check scope"}
          </Button>
        </form>
      </div>

      {/* Results */}
      <div className="flex flex-col gap-6">
        {!scopeResult && !loading && (
          <div
            className="bg-surface rounded-card p-8"
            style={{ border: "0.5px solid var(--color-border)" }}
          >
            <p className="text-sm text-text-tertiary" style={{ lineHeight: 1.7 }}>
              Enter your CN code and import value to see whether CBAM applies, your
              estimated liability, and your next steps.
            </p>
          </div>
        )}

        {loading && (
          <div
            className="bg-surface rounded-card p-8 flex items-center gap-3"
            style={{ border: "0.5px solid var(--color-border)" }}
          >
            <div
              className="w-4 h-4 rounded-full border-2 border-navy border-t-transparent animate-spin"
              style={{ flexShrink: 0 }}
            />
            <p className="text-sm text-text-secondary">Checking against Annex VI…</p>
          </div>
        )}

        {scopeResult && (
          <>
            {/* Scope result card */}
            <div
              className="bg-surface rounded-card p-8"
              style={{ border: "0.5px solid var(--color-border)", boxShadow: "var(--card-shadow)" }}
            >
              <div className="flex items-start justify-between gap-4 mb-6">
                <div>
                  <p className="text-xs text-text-tertiary mb-2" style={{ letterSpacing: "0.08em" }}>
                    SCOPE RESULT
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <StatusBadge
                      ok={scopeResult.in_scope}
                      label={scopeResult.in_scope ? "In scope" : "Not in scope"}
                    />
                    {scopeResult.in_scope && (
                      <StatusBadge
                        ok={!scopeResult.registration_required}
                        label={
                          scopeResult.registration_required
                            ? "Registration required"
                            : scopeResult.approaching_threshold
                            ? "Approaching threshold"
                            : "Below threshold"
                        }
                      />
                    )}
                  </div>
                </div>
                {scopeResult.sector && (
                  <span
                    className="text-xs rounded-badge px-3 py-1.5 shrink-0"
                    style={{
                      fontWeight: 500,
                      backgroundColor: "var(--color-bg)",
                      color: "var(--color-text-secondary)",
                      border: "0.5px solid var(--color-border)",
                    }}
                  >
                    {sectorLabel(scopeResult.sector)}
                  </span>
                )}
              </div>

              {scopeResult.cn_description && (
                <p className="text-sm text-text-primary mb-4" style={{ fontWeight: 500 }}>
                  {scopeResult.cn_description}
                </p>
              )}

              <p className="text-sm text-text-secondary mb-0" style={{ lineHeight: 1.7 }}>
                {scopeResult.reason}
              </p>

              {scopeResult.first_return_due && (
                <div
                  className="mt-6 pt-6"
                  style={{ borderTop: "0.5px solid var(--color-border)" }}
                >
                  <p className="text-xs text-text-tertiary">First return due</p>
                  <p className="text-sm text-text-primary mt-1" style={{ fontWeight: 500 }}>
                    {new Date(scopeResult.first_return_due).toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })}
                  </p>
                </div>
              )}
            </div>

            {/* Liability estimate card */}
            {liabilityResult && (
              <div
                className="bg-surface rounded-card p-8"
                style={{ border: "0.5px solid var(--color-border)", boxShadow: "var(--card-shadow)" }}
              >
                <p className="text-xs text-text-tertiary mb-6" style={{ letterSpacing: "0.08em" }}>
                  LIABILITY ESTIMATE
                </p>

                <p
                  className="text-hero text-navy mb-2"
                  style={{
                    fontWeight: 500,
                    letterSpacing: "-0.03em",
                    lineHeight: 1.0,
                  }}
                >
                  {formatGBP(liabilityResult.gross_cbam_liability_gbp)}
                </p>
                <p className="text-xs text-text-tertiary mb-8">
                  estimated annual CBAM liability · default values · {scopeResult.regime} regime
                </p>

                <div className="grid grid-cols-2 gap-6 mb-8">
                  <div>
                    <p className="text-xs text-text-tertiary mb-1">Embedded emissions</p>
                    <p className="text-sm text-text-primary" style={{ fontWeight: 500 }}>
                      {liabilityResult.total_embedded_tco2e.toLocaleString("en-GB", {
                        minimumFractionDigits: 1,
                        maximumFractionDigits: 1,
                      })}{" "}
                      tCO₂e
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-text-tertiary mb-1">CBAM rate</p>
                    <p className="text-sm text-text-primary" style={{ fontWeight: 500 }}>
                      £{liabilityResult.cbam_rate_gbp_per_tco2e.toFixed(2)}/tCO₂e
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-text-tertiary mb-1">Emissions intensity</p>
                    <p className="text-sm text-text-primary" style={{ fontWeight: 500 }}>
                      {liabilityResult.emissions_intensity_tco2e_per_t.toFixed(3)} tCO₂e/t
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-text-tertiary mb-1">Saving with actual data</p>
                    <p className="text-sm text-green" style={{ fontWeight: 500 }}>
                      {formatGBP(liabilityResult.if_actual_data_saving_gbp)}
                    </p>
                  </div>
                </div>

                {liabilityResult.annual_subscription_comparison && (
                  <div
                    className="rounded-card p-4"
                    style={{ backgroundColor: "var(--color-bg)", border: "0.5px solid var(--color-border)" }}
                  >
                    <p className="text-xs text-text-secondary" style={{ lineHeight: 1.6 }}>
                      {liabilityResult.annual_subscription_comparison.message}
                    </p>
                  </div>
                )}

                <p className="text-xs text-text-tertiary mt-6" style={{ lineHeight: 1.6 }}>
                  {liabilityResult.disclaimer}
                </p>
              </div>
            )}

            {/* Next steps */}
            {scopeResult.next_steps.length > 0 && (
              <div
                className="bg-surface rounded-card p-8"
                style={{ border: "0.5px solid var(--color-border)" }}
              >
                <p
                  className="text-xs text-text-tertiary mb-6"
                  style={{ letterSpacing: "0.08em" }}
                >
                  NEXT STEPS
                </p>
                <ol className="flex flex-col gap-4">
                  {scopeResult.next_steps.map((step, i) => (
                    <li key={i} className="flex gap-4">
                      <span
                        className="text-xs text-text-tertiary shrink-0 mt-0.5"
                        style={{ fontWeight: 500, minWidth: "20px" }}
                      >
                        {i + 1}.
                      </span>
                      <p className="text-sm text-text-secondary" style={{ lineHeight: 1.7 }}>
                        {step}
                      </p>
                    </li>
                  ))}
                </ol>

                <div
                  className="mt-8 pt-6 flex flex-col sm:flex-row gap-3"
                  style={{ borderTop: "0.5px solid var(--color-border)" }}
                >
                  <Button href="/demo" variant="primary">
                    Talk to us about compliance
                  </Button>
                  <Button onClick={reset} variant="ghost">
                    Check another code
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
