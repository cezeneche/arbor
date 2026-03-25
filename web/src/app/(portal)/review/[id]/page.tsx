"use client";

import Link from "next/link";
import { use, useState } from "react";
import { useCase } from "@/lib/hooks/useCases";
import { approveCase, rejectCase } from "@/lib/api/cases";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toStatusVariant, statusLabel, periodLabel } from "@/lib/design-system";

export default function ReviewDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { case_, isLoading, error } = useCase(id);

  const [name,     setName]     = useState("");
  const [email,    setEmail]    = useState("");
  const [comments, setComments] = useState("");
  const [action,   setAction]   = useState<"approve" | "reject" | null>(null);
  const [saving,   setSaving]   = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [done,     setDone]     = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!action || !name.trim() || !email.trim()) return;
    setSaving(true);
    setSaveError(null);

    try {
      const decision = { reviewer_name: name.trim(), reviewer_email: email.trim(), comments: comments.trim() || undefined };
      if (action === "approve") await approveCase(id, decision);
      else                      await rejectCase(id, decision);
      setDone(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Could not save decision.");
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) {
    return (
      <div className="page-content">
        <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>Loading…</p>
      </div>
    );
  }

  if (error || !case_) {
    return (
      <div className="page-content">
        <p style={{ fontSize: "var(--text-sm)", color: "var(--color-red)" }}>{error?.message ?? "Case not found."}</p>
      </div>
    );
  }

  if (done) {
    return (
      <div className="page-content">
        <p style={{ fontSize: "var(--text-lg)", fontWeight: "var(--font-focal)", color: "var(--color-text-primary)", marginBottom: "var(--space-16)" }}>
          {action === "approve" ? "Case approved." : "Case rejected."}
        </p>
        <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", marginBottom: "var(--space-32)" }}>
          The decision has been recorded in the audit log.
        </p>
        <Link href="/review" style={{ fontSize: "var(--text-sm)", fontWeight: "var(--font-focal)", color: "var(--color-navy)" }}>
          ← Back to review queue
        </Link>
      </div>
    );
  }

  return (
    <div className="page-content">
      <Link
        href="/review"
        style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", display: "inline-block", marginBottom: "var(--space-32)" }}
      >
        ← Review queue
      </Link>

      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-16)", marginBottom: "var(--space-32)" }}>
        <h1 style={{ fontSize: "var(--text-lg)", fontWeight: "var(--font-focal)", color: "var(--color-text-primary)" }}>
          {case_.importer_name}
        </h1>
        <Badge variant={toStatusVariant(case_.status)}>{statusLabel(case_.status)}</Badge>
      </div>

      <div style={{ display: "flex", gap: "var(--space-32)", marginBottom: "var(--space-48)" }}>
        <span style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>
          {case_.importer_eori}
        </span>
        <span style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>
          {periodLabel(case_.reporting_year, case_.reporting_quarter)}
        </span>
        <Link href={`/cases/${id}/report`} style={{ fontSize: "var(--text-sm)", fontWeight: "var(--font-focal)", color: "var(--color-navy)" }}>
          View report →
        </Link>
      </div>

      <div className="divider" style={{ marginBottom: "var(--space-48)" }} />

      {/* Review form */}
      <form onSubmit={handleSubmit} style={{ maxWidth: "480px" }}>
        <h2 style={{ fontSize: "var(--text-base)", fontWeight: "var(--font-focal)", color: "var(--color-text-primary)", marginBottom: "var(--space-24)" }}>
          Record decision
        </h2>

        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-16)", marginBottom: "var(--space-32)" }}>
          <Input label="Your name" value={name} onChange={(e) => setName(e.target.value)} required />
          <Input label="Your email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
            <label style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", fontWeight: "var(--font-body)" }}>
              Comments (optional)
            </label>
            <textarea
              value={comments}
              onChange={(e) => setComments(e.target.value)}
              rows={3}
              style={{
                padding:         "var(--space-16)",
                border:          "var(--border-width) solid var(--color-border)",
                borderRadius:    "var(--input-radius)",
                fontSize:        "var(--text-base)",
                fontWeight:      "var(--font-body)",
                fontFamily:      "inherit",
                color:           "var(--color-text-primary)",
                backgroundColor: "var(--color-surface)",
                resize:          "vertical",
                outline:         "none",
                width:           "100%",
              }}
            />
          </div>
        </div>

        {saveError && (
          <p style={{ fontSize: "var(--text-sm)", color: "var(--color-red)", marginBottom: "var(--space-16)" }}>
            {saveError}
          </p>
        )}

        {/* Inline action selection — no modal */}
        <div style={{ display: "flex", gap: "var(--space-16)" }}>
          <Button
            type="submit"
            variant="primary"
            loading={saving && action === "approve"}
            disabled={saving}
            onClick={() => setAction("approve")}
          >
            Approve
          </Button>
          <Button
            type="submit"
            variant="secondary"
            loading={saving && action === "reject"}
            disabled={saving}
            onClick={() => setAction("reject")}
          >
            Reject
          </Button>
        </div>
      </form>
    </div>
  );
}
