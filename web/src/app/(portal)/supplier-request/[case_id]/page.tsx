"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCase } from "@/lib/hooks/useCases";
import { useAuth } from "@/lib/auth/useAuth";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCNCode } from "@/lib/design-system";
import type { CBAMGoodsLine } from "@/lib/types";

// ── Constants ─────────────────────────────────────────────────────────────────

const MONO: React.CSSProperties = {
  fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
};

const inputBase: React.CSSProperties = {
  width:           "100%",
  height:          "var(--input-height)",
  padding:         "0 var(--space-16)",
  fontSize:        "var(--text-base)",
  fontWeight:      "var(--font-body)",
  fontFamily:      "inherit",
  color:           "var(--color-text-primary)",
  backgroundColor: "var(--color-surface)",
  border:          "var(--border-width) solid var(--color-border)",
  borderRadius:    "var(--input-radius)",
  outline:         "none",
  boxSizing:       "border-box",
};

// ── Email builder ─────────────────────────────────────────────────────────────

function buildEmailBody({
  supplierName,
  cnCode,
  description,
  userName,
  companyName,
}: {
  supplierName: string;
  cnCode:       string;
  description:  string;
  userName:     string;
  companyName:  string;
}): string {
  const cn   = formatCNCode(cnCode);
  const dear = supplierName.trim() || "[Supplier name]";
  const prod = description.trim()  || "[product description]";
  const name = userName.trim()     || "[Your name]";
  const co   = companyName.trim()  || "[Company name]";

  return `Dear ${dear},

We import ${prod} (CN ${cn}) from your facility and are required to report the embedded carbon emissions of these goods to HMRC under the UK Carbon Border Adjustment Mechanism, which takes effect from January 2027.

To calculate our CBAM liability accurately, we need the following data for goods produced at your facility:

— Specific embedded emissions (direct), in tCO₂e per tonne of product
— Production route used (e.g. electric arc furnace, blast furnace)
— Country and facility of production
— The reporting period this data covers

If you have completed EU CBAM reporting, this data will already be available from your CBAM compliance records.

We are required to retain this data for 6 years under UK CBAM regulations.

Please reply to this email with the data, or forward this request to your sustainability or compliance team.

Thank you,
${name}
${co}`;
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SupplierRequestPage({
  params,
}: {
  params: Promise<{ case_id: string }>;
}) {
  const { case_id }      = use(params);
  const searchParams     = useSearchParams();
  const cnCodeParam      = searchParams.get("cn_code") ?? "";
  const { user }         = useAuth();
  const { case_, isLoading } = useCase(case_id);

  // Resolve the matching goods line (or first line as fallback)
  const line: CBAMGoodsLine | undefined =
    case_?.goods_lines?.find((l) => l.cn_code === cnCodeParam) ??
    case_?.goods_lines?.[0];

  // Controlled fields
  const [supplierName,  setSupplierName]  = useState("");
  const [supplierEmail, setSupplierEmail] = useState("");
  const [emailBody,     setEmailBody]     = useState("");
  const [emailError,    setEmailError]    = useState("");
  const [sent,          setSent]          = useState(false);

  // Read company name from registration localStorage (page 5 storage)
  const [companyName, setCompanyName] = useState("");
  useEffect(() => {
    try {
      const raw = localStorage.getItem("nucleos_reg_state");
      if (raw) {
        const parsed = JSON.parse(raw) as { businessName?: string };
        setCompanyName(parsed.businessName ?? "");
      }
    } catch { /* ignore */ }
  }, []);

  // Initialise fields when case data loads
  useEffect(() => {
    if (!line) return;
    const name = line.installation_name ?? "";
    setSupplierName(name);
    setEmailBody(
      buildEmailBody({
        supplierName: name,
        cnCode:       line.cn_code,
        description:  line.description,
        userName:     user?.name ?? user?.sub ?? "",
        companyName,
      })
    );
  // Runs once when line/user/companyName first resolves — intentional
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [line?.id, user?.sub, companyName]);

  // Derived
  const cnCode      = line?.cn_code      ?? cnCodeParam;
  const description = line?.description  ?? "";
  const subject     = `CBAM emissions data request — ${formatCNCode(cnCode)} ${description}`.trim();
  const fullText    = `Subject: ${subject}\n\n${emailBody}`;

  // ── Actions ────────────────────────────────────────────────────────────────

  function validate(): boolean {
    if (!supplierEmail.trim()) {
      setEmailError("Supplier email is required before sending.");
      return false;
    }
    if (!supplierEmail.includes("@")) {
      setEmailError("Enter a valid email address.");
      return false;
    }
    setEmailError("");
    return true;
  }

  function handleSendEmail() {
    if (!validate()) return;
    const mailto =
      `mailto:${encodeURIComponent(supplierEmail)}` +
      `?subject=${encodeURIComponent(subject)}` +
      `&body=${encodeURIComponent(emailBody)}`;
    window.location.href = mailto;
    setSent(true);
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(fullText);
    } catch { /* clipboard blocked — fail silently */ }
    setSent(true);
  }

  function handleDownload() {
    const blob = new Blob([fullText], { type: "text/plain" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `supplier-request-${formatCNCode(cnCode)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    setSent(true);
  }

  // ── Loading skeleton ───────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div style={{ maxWidth: 640, margin: "0 auto", padding: "0 var(--space-32) var(--space-80)" }}>
        <Skeleton height={13} width={160} style={{ marginBottom: "var(--space-40)" }} />
        <Skeleton height={24} width={320} style={{ marginBottom: "var(--space-16)" }} />
        <Skeleton height={15} width={440} style={{ marginBottom: "var(--space-32)" }} />
        <Skeleton height={40} style={{ marginBottom: "var(--space-16)" }} />
        <Skeleton height={40} style={{ marginBottom: "var(--space-32)" }} />
        <Skeleton height={480} borderRadius={8} />
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        maxWidth: 640,
        margin:   "0 auto",
        padding:  "var(--space-48) var(--space-32) var(--space-80)",
      }}
    >
      {/* Back link */}
      <Link
        href={`/cases/${case_id}`}
        style={{
          display:      "inline-block",
          fontSize:     "var(--text-sm)",
          fontWeight:   "var(--font-body)",
          color:        "var(--color-text-secondary)",
          marginBottom: "var(--space-40)",
        }}
      >
        ← Back to case {case_id.slice(0, 8)}
      </Link>

      {/* Heading */}
      <h1
        style={{
          fontSize:     "var(--text-lg)",
          fontWeight:   "var(--font-focal)",
          color:        "var(--color-text-primary)",
          marginBottom: "var(--space-8)",
        }}
      >
        Request supplier emissions data
      </h1>
      <p
        style={{
          fontSize:     "var(--text-base)",
          fontWeight:   "var(--font-body)",
          color:        "var(--color-text-secondary)",
          marginBottom: "var(--space-32)",
        }}
      >
        We&apos;ve written an email to your supplier. Review it and send.
      </p>

      {/* ── Supplier fields ── */}
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-16)", marginBottom: "var(--space-32)" }}>
        {/* Supplier name */}
        <div>
          <label
            style={{
              display:      "block",
              fontSize:     "var(--text-sm)",
              fontWeight:   "var(--font-body)",
              color:        "var(--color-text-secondary)",
              marginBottom: "var(--space-8)",
            }}
          >
            Supplier name
          </label>
          <input
            type="text"
            value={supplierName}
            onChange={(e) => setSupplierName(e.target.value)}
            style={inputBase}
          />
        </div>

        {/* Supplier email */}
        <div>
          <label
            style={{
              display:      "block",
              fontSize:     "var(--text-sm)",
              fontWeight:   "var(--font-body)",
              color:        "var(--color-text-secondary)",
              marginBottom: "var(--space-8)",
            }}
          >
            Supplier email
          </label>
          <input
            type="email"
            value={supplierEmail}
            onChange={(e) => {
              setSupplierEmail(e.target.value);
              if (emailError) setEmailError("");
            }}
            placeholder="supplier@example.com"
            style={{
              ...inputBase,
              // ≥16px font on mobile prevents zoom-on-focus
              fontSize: "max(16px, var(--text-base))",
            }}
          />
          {emailError && (
            <p
              style={{
                fontSize:  "var(--text-sm)",
                color:     "var(--color-red)",
                marginTop: "var(--space-8)",
              }}
            >
              {emailError}
            </p>
          )}
        </div>
      </div>

      {/* Subject preview */}
      <p
        style={{
          fontSize:     "var(--text-sm)",
          fontWeight:   "var(--font-body)",
          color:        "var(--color-text-tertiary)",
          marginBottom: "var(--space-8)",
        }}
      >
        Subject:{" "}
        <span style={{ color: "var(--color-text-secondary)" }}>
          CBAM emissions data request —{" "}
          <span style={MONO}>{formatCNCode(cnCode)}</span>
          {description ? ` ${description}` : ""}
        </span>
      </p>

      {/* Email body — styled editable textarea */}
      <textarea
        value={emailBody}
        onChange={(e) => setEmailBody(e.target.value)}
        rows={20}
        style={{
          width:           "100%",
          minHeight:       500,
          padding:         "var(--space-24)",
          fontSize:        "var(--text-base)",
          fontWeight:      "var(--font-body)",
          fontFamily:      "inherit",
          lineHeight:      "var(--leading-body)",
          color:           "var(--color-text-primary)",
          backgroundColor: "var(--color-surface)",
          border:          "var(--border-width) solid var(--color-border)",
          borderRadius:    "var(--card-radius)",
          outline:         "none",
          resize:          "vertical",
          boxSizing:       "border-box",
          marginBottom:    "var(--space-24)",
        }}
      />

      {/* ── Actions ── */}
      {sent ? (
        <p
          style={{
            fontSize:   "var(--text-base)",
            fontWeight: "var(--font-body)",
            color:      "var(--color-green)",
          }}
        >
          Email ready to send.{" "}
          <Link
            href={`/cases/${case_id}`}
            style={{ color: "var(--color-green)", textDecoration: "underline" }}
          >
            ← Back to case
          </Link>
        </p>
      ) : (
        <div
          style={{
            display:   "flex",
            alignItems: "center",
            gap:        "var(--space-24)",
            flexWrap:  "wrap",
          }}
        >
          <Button variant="primary" onClick={handleSendEmail}>
            Send email
          </Button>
          <Button variant="secondary" onClick={handleCopy}>
            Copy to clipboard
          </Button>
          <button
            onClick={handleDownload}
            style={{
              background:  "none",
              border:      "none",
              padding:     0,
              cursor:      "pointer",
              fontSize:    "var(--text-base)",
              fontWeight:  "var(--font-body)",
              fontFamily:  "inherit",
              color:       "var(--color-text-secondary)",
              textDecoration: "underline",
              minHeight:   44,
            }}
          >
            Download as .txt
          </button>
        </div>
      )}
    </div>
  );
}
