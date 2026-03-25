"use client";

import { useAuth } from "@/lib/auth/useAuth";

export default function SettingsPage() {
  const { user } = useAuth();

  return (
    <div className="page-content">
      <h1
        style={{
          fontSize:     "var(--text-lg)",
          fontWeight:   "var(--font-focal)",
          color:        "var(--color-text-primary)",
          marginBottom: "var(--space-32)",
        }}
      >
        Account
      </h1>

      <div
        style={{
          backgroundColor: "var(--color-surface)",
          border:          "var(--border-width) solid var(--color-border)",
          borderRadius:    "var(--card-radius)",
          padding:         "var(--space-32)",
          maxWidth:        "480px",
        }}
      >
        <dl style={{ display: "grid", rowGap: "var(--space-24)" }}>
          {[
            { label: "User ID", value: user?.sub ?? "—" },
            { label: "Tenant", value: user?.tenant_id ?? "—" },
            { label: "Scopes", value: user?.scopes.join(", ") ?? "—" },
          ].map(({ label, value }) => (
            <div key={label}>
              <dt
                style={{
                  fontSize:     "var(--text-xs)",
                  color:        "var(--color-text-tertiary)",
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  marginBottom: "var(--space-8)",
                }}
              >
                {label}
              </dt>
              <dd
                style={{
                  fontSize:   "var(--text-sm)",
                  color:      "var(--color-text-primary)",
                  fontFamily: label === "User ID" || label === "Tenant" ? "monospace" : "inherit",
                  margin:     0,
                }}
              >
                {value}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
