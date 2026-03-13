"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { login } from "@/lib/api";
import { saveToken } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { ShieldCheck, Zap, Lock } from "lucide-react";

const DEFAULT_SCOPES = ["cbam:read", "cbam:write", "narrative:run", "review:write"];

const FEATURES = [
  {
    icon: ShieldCheck,
    title: "EU 2023/1773 compliant",
    desc: "Three-tier method selection — actual, estimated, and Annex VI defaults — encoded to the regulation.",
  },
  {
    icon: Zap,
    title: "Automatic data extraction",
    desc: "Invoices, mill certificates, and customs declarations parsed by AI with regex verification.",
  },
  {
    icon: Lock,
    title: "HMAC audit trail",
    desc: "Every calculation step is signed and chained. Tamper-evident, export-ready for regulators.",
  },
];

const TRUST = ["EU CBAM 2023/956", "End-to-end encrypted", "SOC 2 ready"];

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();

  const [sub, setSub] = useState("dev-user");
  const [tenantId, setTenantId] = useState("dev-org");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const { access_token } = await login(sub, tenantId, DEFAULT_SCOPES);
      saveToken(access_token);
      document.cookie = `cbam_token=${access_token}; path=/; max-age=3600`;
      const next = searchParams.get("next") ?? "/dashboard";
      router.push(next);
    } catch (err) {
      toast({
        title: "Sign-in failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="min-h-screen flex"
      style={{ fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif" }}
    >
      {/* ── LEFT PANEL ── */}
      <div
        className="hidden lg:flex flex-col justify-between w-[52%] px-16 py-14"
        style={{ backgroundColor: "#0d1623" }}
      >
        <div className="flex items-center gap-3">
          <span
            className="flex items-center justify-center w-9 h-9 rounded-lg text-white text-xs font-bold tracking-tight flex-shrink-0"
            style={{ backgroundColor: "#1D9E75" }}
          >
            CB
          </span>
          <span className="text-white font-semibold text-base tracking-tight">
            CBAM Portal
          </span>
        </div>

        <div className="space-y-10">
          <h1
            className="text-4xl font-bold leading-tight"
            style={{ color: "#f0f4f8", letterSpacing: "-0.03em" }}
          >
            Carbon reporting,
            <br />
            made manageable.
          </h1>

          <ul className="space-y-7">
            {FEATURES.map(({ icon: Icon, title, desc }) => (
              <li key={title} className="flex gap-4">
                <span
                  className="flex items-center justify-center w-9 h-9 rounded-lg flex-shrink-0 mt-0.5"
                  style={{ backgroundColor: "rgba(29,158,117,0.15)" }}
                >
                  <Icon size={17} style={{ color: "#1D9E75" }} aria-hidden="true" />
                </span>
                <div>
                  <p className="text-sm font-semibold" style={{ color: "#e2e8f0" }}>{title}</p>
                  <p className="text-sm mt-1 leading-relaxed" style={{ color: "#6b7f96" }}>{desc}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-xs" style={{ color: "#3d5166" }}>
          © 2026 CBAM Portal · EU Regulation 2023/956 · 2023/1773
        </p>
      </div>

      {/* ── RIGHT PANEL ── */}
      <div
        className="flex flex-1 flex-col items-center justify-center px-8 py-14"
        style={{ backgroundColor: "#0e1520" }}
      >
        {/* Mobile wordmark */}
        <div className="flex items-center gap-2.5 mb-10 lg:hidden">
          <span
            className="flex items-center justify-center w-8 h-8 rounded-lg text-white text-xs font-bold"
            style={{ backgroundColor: "#1D9E75" }}
          >
            CB
          </span>
          <span className="text-white font-semibold text-base">CBAM Portal</span>
        </div>

        <div className="w-full max-w-[400px]">
          <div className="mb-8">
            <div className="flex items-center gap-3 mb-1">
              <h2 className="text-xl font-semibold text-white">Sign in to your account</h2>
              <span
                className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold flex-shrink-0"
                style={{
                  backgroundColor: "rgba(217,119,6,0.18)",
                  color: "#fbbf24",
                  border: "1px solid rgba(217,119,6,0.3)",
                }}
              >
                Dev mode
              </span>
            </div>
            <p className="text-sm" style={{ color: "#6b7f96" }}>
              Enter any user ID and organisation to generate a session token.
            </p>
          </div>

          <form onSubmit={handleSubmit} noValidate>
            <div
              className="rounded-[10px] p-6 space-y-5"
              style={{
                backgroundColor: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.07)",
              }}
            >
              {/* User ID */}
              <div className="flex flex-col gap-1.5">
                <label htmlFor="sub" className="text-sm font-medium" style={{ color: "#c8d8e8" }}>
                  User ID
                </label>
                <input
                  id="sub"
                  type="text"
                  value={sub}
                  onChange={(e) => setSub(e.target.value)}
                  placeholder="dev-user"
                  required
                  autoComplete="username"
                  className="w-full px-4 text-white placeholder:text-[#3d5166] text-base outline-none"
                  style={{
                    height: "48px",
                    borderRadius: "10px",
                    backgroundColor: "rgba(255,255,255,0.05)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    transition: "border-color 0.1s, box-shadow 0.1s",
                  }}
                  onFocus={(e) => {
                    e.target.style.borderColor = "#1D9E75";
                    e.target.style.boxShadow = "0 0 0 3px rgba(29,158,117,0.2)";
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = "rgba(255,255,255,0.1)";
                    e.target.style.boxShadow = "none";
                  }}
                />
              </div>

              {/* Organisation ID */}
              <div className="flex flex-col gap-1.5">
                <label htmlFor="tenant" className="text-sm font-medium" style={{ color: "#c8d8e8" }}>
                  Organisation ID
                </label>
                <input
                  id="tenant"
                  type="text"
                  value={tenantId}
                  onChange={(e) => setTenantId(e.target.value)}
                  placeholder="dev-org"
                  required
                  autoComplete="organization"
                  className="w-full px-4 text-white placeholder:text-[#3d5166] text-base outline-none"
                  style={{
                    height: "48px",
                    borderRadius: "10px",
                    backgroundColor: "rgba(255,255,255,0.05)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    transition: "border-color 0.1s, box-shadow 0.1s",
                  }}
                  onFocus={(e) => {
                    e.target.style.borderColor = "#1D9E75";
                    e.target.style.boxShadow = "0 0 0 3px rgba(29,158,117,0.2)";
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = "rgba(255,255,255,0.1)";
                    e.target.style.boxShadow = "none";
                  }}
                />
                <p className="text-xs" style={{ color: "#6b7f96" }}>
                  Your EORI-linked organisation identifier
                </p>
              </div>

              {/* Sign-in button — 52px height */}
              <button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center font-semibold text-white text-base"
                style={{
                  height: "52px",
                  borderRadius: "10px",
                  backgroundColor: loading ? "#15785a" : "#1D9E75",
                  opacity: loading ? 0.8 : 1,
                  cursor: loading ? "not-allowed" : "pointer",
                  border: "none",
                  transition: "background-color 0.1s, opacity 0.1s",
                }}
                onMouseEnter={(e) => {
                  if (!loading) (e.currentTarget.style.backgroundColor = "#18b585");
                }}
                onMouseLeave={(e) => {
                  if (!loading) (e.currentTarget.style.backgroundColor = "#1D9E75");
                }}
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                    Signing in…
                  </span>
                ) : (
                  "Sign in"
                )}
              </button>
            </div>

            {/* Trust row */}
            <div className="flex items-center justify-center gap-5 mt-5">
              {TRUST.map((item, i) => (
                <span key={item} className="flex items-center gap-2">
                  {i > 0 && (
                    <span className="w-1 h-1 rounded-full flex-shrink-0" style={{ backgroundColor: "#2a3a4a" }} aria-hidden="true" />
                  )}
                  <span className="text-xs" style={{ color: "#4a607a" }}>{item}</span>
                </span>
              ))}
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
