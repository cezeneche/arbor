"use client";

import { useState } from "react";
import Link from "next/link";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { saveToken } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

const schema = z.object({
  email:    z.string().min(1, "Email is required").refine((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s), "Enter a valid email"),
  password: z.string().min(1, "Password is required"),
});

type Errors = Partial<Record<keyof z.infer<typeof schema>, string>>;

export default function LoginPage() {
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [errors,   setErrors]   = useState<Errors>({});
  const [authError, setAuthError] = useState<string | null>(null);
  const [loading,  setLoading]  = useState(false);

  // Forgot password inline state
  const [showReset,   setShowReset]   = useState(false);
  const [resetEmail,  setResetEmail]  = useState("");
  const [resetSent,   setResetSent]   = useState(false);
  const [resetLoading, setResetLoading] = useState(false);

  function validate(): boolean {
    const result = schema.safeParse({ email, password });
    if (!result.success) {
      const fieldErrors: Errors = {};
      for (const issue of result.error.issues) {
        const key = issue.path[0] as keyof Errors;
        if (!fieldErrors[key]) fieldErrors[key] = issue.message;
      }
      setErrors(fieldErrors);
      return false;
    }
    setErrors({});
    return true;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    setLoading(true);
    setAuthError(null);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email:    email.trim(),
        password,
      });

      if (error || !data.session) {
        setAuthError("Incorrect email or password");
        return;
      }

      const res = await fetch("/api-proxy/ledger/api/auth/supabase", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ access_token: data.session.access_token }),
      });

      if (!res.ok) {
        setAuthError("Unable to sign in. Please try again.");
        return;
      }

      const tokenData = await res.json();
      saveToken(tokenData.access_token);
      document.cookie = `cbam_token=${encodeURIComponent(tokenData.access_token)}; path=/; max-age=3600`;
      window.location.href = "/";
    } catch {
      setAuthError("Incorrect email or password");
    } finally {
      setLoading(false);
    }
  }

  async function handleResetSubmit() {
    if (!resetEmail.trim()) return;
    setResetLoading(true);
    // Simulate — real reset endpoint wired when available
    await new Promise((r) => setTimeout(r, 800));
    setResetLoading(false);
    setResetSent(true);
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
        {/* Wordmark — Inter 500, tight tracking, always lowercase */}
        <div style={{ marginBottom: "var(--space-80)" }}>
          <span style={{
            fontSize:      "20px",
            fontWeight:    500,
            color:         "var(--color-text-primary)",
            letterSpacing: "-0.03em",
            lineHeight:    1,
            fontFamily:    "inherit",
          }}>
            nucleos
          </span>
        </div>

        <h1
          style={{
            fontSize:     "var(--text-lg)",
            fontWeight:   "var(--font-focal)",
            color:        "var(--color-text-primary)",
            marginBottom: "var(--space-32)",
          }}
        >
          Sign in
        </h1>

        <form onSubmit={handleSubmit} noValidate>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-16)" }}>

            {/* Email */}
            <Input
              id="email"
              label="Email address"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setAuthError(null); }}
              error={errors.email}
            />

            {/* Forgot password — inline below email field, no card, no modal */}
            {showReset && (
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
                {resetSent ? (
                  <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", margin: 0 }}>
                    If that address is registered you&apos;ll receive a reset link shortly.
                  </p>
                ) : (
                  <>
                    <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", margin: 0 }}>
                      Enter your email address and we&apos;ll send a reset link.
                    </p>
                    <Input
                      id="reset-email"
                      label=""
                      type="email"
                      autoComplete="email"
                      value={resetEmail}
                      onChange={(e) => setResetEmail(e.target.value)}
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      loading={resetLoading}
                      style={{ alignSelf: "flex-start" }}
                      onClick={handleResetSubmit}
                    >
                      Send reset link
                    </Button>
                  </>
                )}
              </div>
            )}

            {/* Password */}
            <Input
              id="password"
              label="Password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setAuthError(null); }}
              error={errors.password}
            />

            {/* Auth error — single line below password, never specifies which field */}
            {authError && (
              <p style={{ fontSize: "var(--text-sm)", color: "var(--color-red)", margin: 0 }}>
                {authError}
              </p>
            )}

            <Button
              type="submit"
              variant="primary"
              loading={loading}
              style={{ width: "100%", marginTop: "var(--space-8)" }}
            >
              Sign in
            </Button>

            {/* Forgot password trigger — right-aligned */}
            <div style={{ textAlign: "right" }}>
              <button
                type="button"
                onClick={() => {
                  setResetEmail(email);
                  setShowReset((v) => !v);
                  setResetSent(false);
                }}
                style={{
                  background:  "none",
                  border:      "none",
                  padding:     0,
                  cursor:      "pointer",
                  fontSize:    "var(--text-sm)",
                  color:       "var(--color-text-secondary)",
                  fontFamily:  "inherit",
                }}
              >
                Forgot your password?
              </button>
            </div>
          </div>
        </form>

        {/* Divider + signup link */}
        <div style={{ marginTop: "var(--space-40)" }}>
          <div
            style={{
              borderTop: "var(--border-width) solid var(--color-border)",
              marginBottom: "var(--space-24)",
            }}
          />
          <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>
            New to Nucleos?{" "}
            <Link
              href="/signup"
              style={{ color: "var(--color-text-secondary)", textDecoration: "underline" }}
            >
              Create an account →
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
