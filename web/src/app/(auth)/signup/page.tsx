"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { saveToken } from "@/lib/auth";

const schema = z.object({
  fullName:    z.string().min(1, "Full name is required"),
  companyName: z.string().min(1, "Company name is required"),
  email:       z.string().min(1, "Email is required").email("Enter a valid email"),
  password:    z.string().min(8, "At least 8 characters"),
});

type FormValues = z.infer<typeof schema>;
type Errors = Partial<Record<keyof FormValues, string>>;

export default function SignupPage() {
  const router = useRouter();

  const [values, setValues] = useState<FormValues>({
    fullName:    "",
    companyName: "",
    email:       "",
    password:    "",
  });
  const [passwordTouched, setPasswordTouched] = useState(false);
  const [errors,   setErrors]  = useState<Errors>({});
  const [loading,  setLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  function set(field: keyof FormValues) {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      setValues((v) => ({ ...v, [field]: e.target.value }));
      setErrors((err) => ({ ...err, [field]: undefined }));
      setApiError(null);
    };
  }

  function validate(): boolean {
    const result = schema.safeParse(values);
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
    setApiError(null);

    try {
      // Register — issue a dev token using the new user's email as subject.
      // Swap for a real /api/auth/register endpoint when available.
      const res = await fetch("/api-proxy/ledger/api/auth/token", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          sub:       values.email.trim(),
          tenant_id: values.companyName.trim().toLowerCase().replace(/\s+/g, "-"),
          scopes:    ["cbam:read", "cbam:write", "narrative:run", "review:write"],
        }),
      });

      if (!res.ok) {
        setApiError("Unable to create account. Please try again.");
        return;
      }

      const data = await res.json();
      saveToken(data.access_token);
      document.cookie = `cbam_token=${encodeURIComponent(data.access_token)}; path=/; max-age=3600`;
      router.replace("/");
    } catch {
      setApiError("Unable to reach the server. Please try again.");
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
            marginBottom: "80px",
          }}
        >
          Nucleos
        </p>

        <h1
          style={{
            fontSize:     "var(--text-lg)",
            fontWeight:   "var(--font-focal)",
            color:        "var(--color-text-primary)",
            marginBottom: "var(--space-32)",
          }}
        >
          Create your account
        </h1>

        <form onSubmit={handleSubmit} noValidate>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-16)" }}>

            <Input
              id="fullName"
              label="Full name"
              type="text"
              autoComplete="name"
              value={values.fullName}
              onChange={set("fullName")}
              error={errors.fullName}
            />

            <Input
              id="companyName"
              label="Company name"
              type="text"
              autoComplete="organization"
              value={values.companyName}
              onChange={set("companyName")}
              error={errors.companyName}
            />

            <Input
              id="email"
              label="Email address"
              type="email"
              autoComplete="email"
              value={values.email}
              onChange={set("email")}
              error={errors.email}
            />

            {/* Password with hint */}
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <Input
                id="password"
                label="Password"
                type="password"
                autoComplete="new-password"
                value={values.password}
                onChange={(e) => {
                  set("password")(e);
                  if (!passwordTouched) setPasswordTouched(true);
                }}
                error={errors.password}
              />
              {passwordTouched && !errors.password && (
                <span
                  style={{
                    fontSize: "var(--text-xs)",
                    color:    "var(--color-text-tertiary)",
                    paddingLeft: "2px",
                  }}
                >
                  At least 8 characters
                </span>
              )}
            </div>

            {apiError && (
              <p style={{ fontSize: "var(--text-sm)", color: "var(--color-red)", margin: 0 }}>
                {apiError}
              </p>
            )}

            <Button
              type="submit"
              variant="primary"
              loading={loading}
              style={{ width: "100%", marginTop: "var(--space-8)" }}
            >
              Create account
            </Button>
          </div>
        </form>

        {/* Sign in link */}
        <p
          style={{
            fontSize:   "var(--text-sm)",
            color:      "var(--color-text-secondary)",
            marginTop:  "var(--space-24)",
          }}
        >
          Already have an account?{" "}
          <Link
            href="/login"
            style={{ color: "var(--color-text-secondary)", textDecoration: "underline" }}
          >
            Sign in →
          </Link>
        </p>
      </div>
    </div>
  );
}
