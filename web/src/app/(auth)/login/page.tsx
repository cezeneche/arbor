"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { saveToken } from "@/lib/auth";

/**
 * Login page — Rams spec:
 *   Centred form. Nucleos logotype. Email + password. One primary button.
 *   Error shown inline below the form. No modal. No toast.
 */
export default function LoginPage() {
  const router = useRouter();
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) { setError("Email is required."); return; }
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api-proxy/ledger/api/auth/token", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          sub:       email.trim(),
          tenant_id: "default",
          scopes:    ["cbam:read", "cbam:write", "narrative:run", "review:write"],
        }),
      });

      if (!res.ok) {
        setError("Invalid credentials. Please try again.");
        return;
      }

      const data = await res.json();
      saveToken(data.access_token);
      document.cookie = `cbam_token=${encodeURIComponent(data.access_token)}; path=/; max-age=3600`;
      router.replace("/cases");
    } catch {
      setError("Unable to reach the server. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        minHeight:       "100vh",
        backgroundColor: "var(--color-bg)",
        display:         "flex",
        alignItems:      "center",
        justifyContent:  "center",
        padding:         "var(--space-32)",
      }}
    >
      <div style={{ width: "100%", maxWidth: "400px" }}>
        {/* Logotype */}
        <p
          style={{
            fontSize:     "var(--text-base)",
            fontWeight:   "var(--font-focal)",
            color:        "var(--color-text-primary)",
            marginBottom: "var(--space-48)",
          }}
        >
          Nucleos
        </p>

        <h1
          style={{
            fontSize:     "var(--text-lg)",
            fontWeight:   "var(--font-focal)",
            color:        "var(--color-text-primary)",
            marginBottom: "var(--space-8)",
          }}
        >
          Sign in
        </h1>
        <p
          style={{
            fontSize:     "var(--text-sm)",
            color:        "var(--color-text-secondary)",
            marginBottom: "var(--space-32)",
          }}
        >
          CBAM compliance platform
        </p>

        <form onSubmit={handleSubmit}>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-16)" }}>
            <Input
              label="Email"
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
            />
            <Input
              label="Password"
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />

            {error && (
              <p
                style={{
                  fontSize: "var(--text-sm)",
                  color:    "var(--color-red)",
                }}
              >
                {error}
              </p>
            )}

            <Button
              type="submit"
              variant="primary"
              loading={loading}
              style={{ marginTop: "var(--space-8)", width: "100%" }}
            >
              Sign in
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
