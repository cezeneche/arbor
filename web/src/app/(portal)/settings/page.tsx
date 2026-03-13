"use client";

/**
 * /settings — Account settings
 *
 * Four sections:
 *   1. Organisation  — read-only org fields derived from JWT + first case
 *   2. Your profile  — editable display name, read-only email, scope badges
 *   3. Notifications — UI-only toggles (no backend)
 *   4. Session       — signed-in identity, expiry, sign-out
 *
 * Profile save stubs PUT /api/cbam/users/me (endpoint may not exist yet —
 * the error state communicates this gracefully).
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { useAuth }  from "@/lib/auth/useAuth";
import { useCases } from "@/lib/hooks/useCases";
import { ledgerFetch } from "@/lib/api/client";

/* ── Scope → plain-English label map ─────────────────────────────────────── */

const SCOPE_LABELS: Record<string, string> = {
  "cbam:read":     "View cases",
  "cbam:write":    "Upload and edit",
  "narrative:run": "Generate reports",
  "review:write":  "Approve submissions",
};

const ALL_SCOPES = ["cbam:read", "cbam:write", "narrative:run", "review:write"] as const;

/* ── Profile save (stub — endpoint may 404) ───────────────────────────────── */

async function putUserProfile(displayName: string): Promise<void> {
  await ledgerFetch<void>("/api/cbam/users/me", {
    method: "PUT",
    body:   JSON.stringify({ display_name: displayName }),
  });
}

/* ── Shared style helpers ─────────────────────────────────────────────────── */

const S = {
  card: {
    background:   "var(--color-surface-raised)",
    border:       "1px solid var(--color-border)",
    borderRadius: "var(--radius-xl)",
    padding:      "var(--space-6)",
  } as React.CSSProperties,

  cardHeading: {
    margin:       0,
    marginBottom: "var(--space-5)",
    fontSize:     "var(--text-base)",
    fontWeight:   "var(--font-weight-semibold)",
    color:        "var(--color-text-primary)",
  } as React.CSSProperties,

  fieldRow: {
    display:       "flex",
    flexDirection: "column" as const,
    gap:           "var(--space-1)",
    marginBottom:  "var(--space-4)",
  } as React.CSSProperties,

  fieldLabel: {
    fontSize:      "var(--text-xs)",
    fontWeight:    "var(--font-weight-medium)",
    color:         "var(--color-text-muted)",
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
  } as React.CSSProperties,

  fieldMono: {
    fontSize:   "var(--text-sm)",
    color:      "var(--color-text-primary)",
    fontFamily: "var(--font-mono)",
  } as React.CSSProperties,

  input: {
    width:        "100%",
    boxSizing:    "border-box" as const,
    padding:      "var(--space-2) var(--space-3)",
    background:   "var(--color-surface)",
    border:       "1px solid var(--color-border)",
    borderRadius: "var(--radius-md)",
    color:        "var(--color-text-primary)",
    fontFamily:   "var(--font-sans)",
    fontSize:     "var(--text-sm)",
    outline:      "none",
  } as React.CSSProperties,
};

/* ── ReadOnlyField ────────────────────────────────────────────────────────── */

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div style={S.fieldRow}>
      <span style={S.fieldLabel}>{label}</span>
      <span style={S.fieldMono}>{value || "—"}</span>
    </div>
  );
}

/* ── ScopeBadge ───────────────────────────────────────────────────────────── */

function ScopeBadge({ scope, active }: { scope: string; active: boolean }) {
  return (
    <span
      style={{
        display:         "inline-flex",
        alignItems:      "center",
        padding:         "2px var(--space-2)",
        borderRadius:    "var(--radius-sm)",
        fontSize:        "var(--text-xs)",
        fontWeight:      "var(--font-weight-medium)",
        backgroundColor: active ? "var(--color-accent-subtle)"  : "var(--color-surface)",
        color:           active ? "var(--color-accent-text)"    : "var(--color-text-muted)",
        border:          `1px solid ${active ? "var(--color-accent-border)" : "var(--color-border)"}`,
      }}
    >
      {SCOPE_LABELS[scope] ?? scope}
    </span>
  );
}

/* ── ToggleRow ────────────────────────────────────────────────────────────── */

function ToggleRow({
  label,
  checked,
  onChange,
  last = false,
}: {
  label:    string;
  checked:  boolean;
  onChange: (v: boolean) => void;
  last?:    boolean;
}) {
  return (
    <div
      style={{
        display:        "flex",
        alignItems:     "center",
        justifyContent: "space-between",
        height:         "48px",
        borderBottom:   last ? "none" : "1px solid var(--color-border)",
      }}
    >
      <span
        style={{
          fontSize: "var(--text-sm)",
          color:    "var(--color-text-secondary)",
          paddingRight: "var(--space-4)",
        }}
      >
        {label}
      </span>

      {/* Custom toggle switch */}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={`${label}: ${checked ? "on" : "off"}`}
        onClick={() => onChange(!checked)}
        style={{
          position:        "relative",
          flexShrink:      0,
          width:           "44px",
          height:          "24px",
          borderRadius:    "9999px",
          border:          "none",
          cursor:          "pointer",
          backgroundColor: checked ? "var(--color-accent)" : "var(--color-border)",
          transition:      "background-color 150ms ease",
          padding:         0,
        }}
      >
        <span
          style={{
            position:        "absolute",
            top:             "3px",
            left:            checked ? "23px" : "3px",
            width:           "18px",
            height:          "18px",
            borderRadius:    "9999px",
            backgroundColor: "#ffffff",
            transition:      "left 150ms ease",
            boxShadow:       "0 1px 3px rgba(0,0,0,0.3)",
          }}
        />
      </button>
    </div>
  );
}

/* ── SettingsPage ─────────────────────────────────────────────────────────── */

export default function SettingsPage() {
  const { user, isLoading, signOut, hasScope } = useAuth();
  const { cases } = useCases();

  /* Derive org fields from the first case (EORI / year not in JWT) */
  const firstCase  = cases[0];
  const orgName    = firstCase?.importer_name  ?? "—";
  const orgEori    = firstCase?.importer_eori  ?? "—";
  const reportYear = firstCase?.reporting_year?.toString() ?? "—";

  /* Profile state */
  const initialNameRef  = useRef("");
  const [displayName, setDisplayName] = useState("");

  useEffect(() => {
    if (user) {
      const n = user.name ?? user.sub ?? "";
      initialNameRef.current = n;
      setDisplayName(n);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.sub]);

  const isDirty = displayName.trim() !== initialNameRef.current.trim();

  type SaveState = "idle" | "saving" | "saved" | "error";
  const [saveState, setSaveState] = useState<SaveState>("idle");

  const handleSave = useCallback(async () => {
    if (!isDirty || saveState === "saving") return;
    setSaveState("saving");
    try {
      await putUserProfile(displayName.trim());
      initialNameRef.current = displayName.trim();
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 2500);
    } catch {
      setSaveState("error");
      setTimeout(() => setSaveState("idle"), 3500);
    }
  }, [displayName, isDirty, saveState]);

  /* Notification toggles — UI only, no backend */
  const [notifReview,  setNotifReview]  = useState(true);
  const [notifGemini,  setNotifGemini]  = useState(true);
  const [notifWeekly,  setNotifWeekly]  = useState(false);

  /* Session expiry display */
  const expDisplay = user?.exp
    ? new Date(user.exp * 1000).toLocaleString("en-GB", {
        day:    "2-digit",
        month:  "short",
        year:   "numeric",
        hour:   "2-digit",
        minute: "2-digit",
      })
    : "—";

  /* Loading state */
  if (isLoading) {
    return (
      <div
        style={{
          padding:    "var(--space-8)",
          fontSize:   "var(--text-sm)",
          color:      "var(--color-text-muted)",
          fontFamily: "var(--font-sans)",
        }}
      >
        Loading…
      </div>
    );
  }

  /* ── Save button colours ── */
  const saveDisabled = !isDirty || saveState === "saving";
  const saveBg    = saveDisabled ? "transparent"           : "var(--color-accent)";
  const saveColor = saveDisabled ? "var(--color-text-muted)" : "var(--color-text-on-accent)";
  const saveBorder = saveDisabled ? "1px solid var(--color-border)" : "none";

  return (
    <div
      style={{
        padding:    "var(--space-8) var(--space-6)",
        maxWidth:   "960px",
        margin:     "0 auto",
        fontFamily: "var(--font-sans)",
      }}
    >
      {/* Page heading */}
      <h1
        style={{
          margin:       0,
          marginBottom: "var(--space-8)",
          fontSize:     "var(--text-2xl)",
          fontWeight:   "var(--font-weight-semibold)",
          color:        "var(--color-text-primary)",
        }}
      >
        Account settings
      </h1>

      {/* Two-column grid: collapses to single on narrow viewports */}
      <div
        style={{
          display:             "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          gap:                 "var(--space-6)",
          alignItems:          "start",
        }}
      >
        {/* ── Left column: Organisation + Profile ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>

          {/* Section 1 — Organisation */}
          <section style={S.card} aria-label="Your organisation">
            <h2 style={S.cardHeading}>Your organisation</h2>

            <ReadOnlyField label="Organisation name"    value={orgName} />
            <ReadOnlyField label="Tenant ID"            value={user?.tenant_id ?? "—"} />
            <ReadOnlyField label="Importer EORI number" value={orgEori} />
            <ReadOnlyField label="Reporting year"       value={reportYear} />

            <p
              style={{
                margin:    0,
                marginTop: "var(--space-2)",
                fontSize:  "var(--text-xs)",
                color:     "var(--color-text-muted)",
              }}
            >
              To update these details, contact your administrator.
            </p>
          </section>

          {/* Section 2 — Your profile */}
          <section style={S.card} aria-label="Your profile">
            <h2 style={S.cardHeading}>Your profile</h2>

            {/* Display name — editable */}
            <div style={{ ...S.fieldRow, marginBottom: "var(--space-5)" }}>
              <label htmlFor="display-name" style={S.fieldLabel}>
                Display name
              </label>
              <input
                id="display-name"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
                style={S.input}
              />
            </div>

            {/* Email — read-only (mapped from sub) */}
            <ReadOnlyField label="Email address" value={user?.sub ?? "—"} />

            {/* Scopes */}
            <div style={{ ...S.fieldRow, marginBottom: "var(--space-5)" }}>
              <span style={S.fieldLabel}>Permissions</span>
              <div
                style={{
                  display:   "flex",
                  flexWrap:  "wrap",
                  gap:       "var(--space-2)",
                  marginTop: "var(--space-1)",
                }}
              >
                {ALL_SCOPES.map((s) => (
                  <ScopeBadge key={s} scope={s} active={hasScope(s)} />
                ))}
              </div>
            </div>

            {/* Save row */}
            <div
              role="status"
              aria-live="polite"
              style={{
                display:    "flex",
                alignItems: "center",
                gap:        "var(--space-3)",
                marginTop:  "var(--space-2)",
              }}
            >
              <button
                type="button"
                disabled={saveDisabled}
                onClick={handleSave}
                style={{
                  display:         "inline-flex",
                  alignItems:      "center",
                  justifyContent:  "center",
                  minHeight:       "var(--touch-min)",
                  padding:         "0 var(--space-5)",
                  borderRadius:    "var(--radius-btn)",
                  border:          saveBorder,
                  backgroundColor: saveBg,
                  color:           saveColor,
                  fontFamily:      "var(--font-sans)",
                  fontSize:        "var(--text-sm)",
                  fontWeight:      "var(--font-weight-semibold)",
                  cursor:          saveDisabled ? "not-allowed" : "pointer",
                  transition:      "background-color var(--transition-fast)",
                }}
              >
                {saveState === "saving" ? "Saving…" : "Save changes"}
              </button>

              {saveState === "saved" && (
                <span style={{ fontSize: "var(--text-sm)", color: "var(--color-approved-text)" }}>
                  Saved
                </span>
              )}
              {saveState === "error" && (
                <span style={{ fontSize: "var(--text-sm)", color: "var(--color-error-text)" }}>
                  Could not save — endpoint not yet available.
                </span>
              )}
            </div>
          </section>
        </div>

        {/* ── Right column: Notifications + Session ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>

          {/* Section 3 — Notifications */}
          <section style={S.card} aria-label="Notifications">
            <h2 style={S.cardHeading}>Notifications</h2>

            <ToggleRow
              label="Email me when a case needs review"
              checked={notifReview}
              onChange={setNotifReview}
            />
            <ToggleRow
              label="Email me when Gemini flags a submission"
              checked={notifGemini}
              onChange={setNotifGemini}
            />
            <ToggleRow
              label="Weekly summary of emissions liability"
              checked={notifWeekly}
              onChange={setNotifWeekly}
              last
            />
          </section>

          {/* Section 4 — Session */}
          <section style={S.card} aria-label="Session">
            <h2 style={S.cardHeading}>Session</h2>

            <div
              style={{
                display:       "flex",
                flexDirection: "column",
                gap:           "var(--space-3)",
                marginBottom:  "var(--space-5)",
              }}
            >
              {/* Identity line */}
              <div
                style={{
                  fontSize:   "var(--text-sm)",
                  color:      "var(--color-text-secondary)",
                  fontFamily: "var(--font-mono)",
                  wordBreak:  "break-all",
                }}
              >
                Signed in as{" "}
                <strong style={{ color: "var(--color-text-primary)" }}>
                  {user?.sub ?? "—"}
                </strong>
                {" · "}
                {user?.tenant_id ?? "—"}
              </div>

              {/* Expiry line */}
              <div
                style={{
                  fontSize: "var(--text-sm)",
                  color:    "var(--color-text-muted)",
                }}
              >
                Session expires {expDisplay}
              </div>
            </div>

            {/* Sign out */}
            <button
              type="button"
              onClick={signOut}
              style={{
                display:         "inline-flex",
                alignItems:      "center",
                justifyContent:  "center",
                minHeight:       "var(--touch-min)",
                padding:         "0 var(--space-5)",
                borderRadius:    "var(--radius-btn)",
                border:          "1px solid var(--color-error)",
                backgroundColor: "transparent",
                color:           "var(--color-error-text)",
                fontFamily:      "var(--font-sans)",
                fontSize:        "var(--text-sm)",
                fontWeight:      "var(--font-weight-semibold)",
                cursor:          "pointer",
                transition:      "background-color var(--transition-fast)",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.backgroundColor =
                  "var(--color-error-bg)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.backgroundColor =
                  "transparent";
              }}
            >
              Sign out
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}
