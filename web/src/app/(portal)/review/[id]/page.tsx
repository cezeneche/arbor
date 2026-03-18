"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import { getReportPackage, getReview, approveCase, rejectCase } from "@/lib/api";

interface Props { params: { id: string } }

const inputStyle: React.CSSProperties = {
  width: "100%",
  height: "var(--touch-min)",
  padding: "0 var(--space-4)",
  borderRadius: "var(--radius-md)",
  border: "1px solid var(--color-border)",
  backgroundColor: "var(--color-surface-raised)",
  color: "var(--color-text-primary)",
  fontSize: "var(--text-sm)",
  fontFamily: "var(--font-sans)",
  boxSizing: "border-box" as const,
  outline: "none",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "var(--text-xs)",
  fontWeight: "var(--font-weight-semibold)",
  color: "var(--color-text-secondary)",
  marginBottom: "var(--space-2)",
  textTransform: "uppercase",
  letterSpacing: "var(--tracking-wide)",
};

export default function ReviewDecisionPage({ params }: Props) {
  const { id } = params;
  const router         = useRouter();
  const queryClient    = useQueryClient();

  const [reviewerName,  setReviewerName]  = useState("");
  const [reviewerEmail, setReviewerEmail] = useState("");
  const [comments,      setComments]      = useState("");
  const [toast, setToast] = useState<{ type: "success" | "error"; msg: string } | null>(null);

  const { data: report, isLoading: reportLoading } = useQuery({
    queryKey: ["report-package", id],
    queryFn: () => getReportPackage(id),
  });

  const { data: reviewState } = useQuery({
    queryKey: ["review", id],
    queryFn: () => getReview(id),
  });

  function onSuccess(msg: string) {
    queryClient.invalidateQueries({ queryKey: ["cbam-cases"] });
    setToast({ type: "success", msg });
    setTimeout(() => router.push("/review"), 1200);
  }

  const { mutate: approve, isPending: approving } = useMutation({
    mutationFn: () => approveCase(id, { reviewer_name: reviewerName, reviewer_email: reviewerEmail, comments }),
    onSuccess: () => onSuccess("Case approved — redirecting…"),
    onError: (err) => setToast({ type: "error", msg: (err as Error).message }),
  });

  const { mutate: reject, isPending: rejecting } = useMutation({
    mutationFn: () => rejectCase(id, { reviewer_name: reviewerName, reviewer_email: reviewerEmail, comments }),
    onSuccess: () => onSuccess("Case rejected — redirecting…"),
    onError: (err) => setToast({ type: "error", msg: (err as Error).message }),
  });

  const alreadyDecided = reviewState?.review_status === "approved" || reviewState?.review_status === "rejected";
  const formValid = reviewerName.trim() && reviewerEmail.trim();
  const busy = approving || rejecting;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
      <Link href="/review" style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-2)", fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", textDecoration: "none" }}>
        ← Back to review queue
      </Link>

      <div>
        <h1 style={{ margin: 0, fontSize: "var(--text-2xl)", fontWeight: "var(--font-weight-semibold)", color: "var(--color-text-primary)" }}>
          Review Decision
        </h1>
        <p style={{ margin: "var(--space-1) 0 0", fontSize: "var(--text-xs)", color: "var(--color-text-muted)", fontFamily: "var(--font-mono)" }}>{id}</p>
      </div>

      {/* Toast */}
      {toast && (
        <div role="alert" style={{ padding: "var(--space-4)", borderRadius: "var(--radius-lg)", backgroundColor: toast.type === "success" ? "var(--color-approved-bg)" : "var(--color-error-bg)", border: `1px solid ${toast.type === "success" ? "var(--color-approved-border)" : "var(--color-error-border)"}`, color: toast.type === "success" ? "var(--color-approved-text)" : "var(--color-error-text)", fontSize: "var(--text-sm)" }}>
          {toast.msg}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: "var(--space-6)", alignItems: "start" }}>

        {/* Narrative */}
        <div style={{ backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-xl)", padding: "var(--space-6)" }}>
          <p style={{ margin: "0 0 var(--space-4)", fontSize: "var(--text-xs)", fontWeight: "var(--font-weight-semibold)", color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "var(--tracking-wide)" }}>
            Compliance narrative
          </p>
          {reportLoading ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
              {Array(6).fill(0).map((_, i) => (
                <div key={i} className="skeleton-shimmer" style={{ height: "14px", borderRadius: "var(--radius-sm)" }} />
              ))}
            </div>
          ) : report?.narrative ? (
            <div style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", lineHeight: "var(--leading-relaxed)" }}>
              <ReactMarkdown>{report.narrative}</ReactMarkdown>
            </div>
          ) : (
            <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--color-text-muted)" }}>
              No narrative available yet. Run the pipeline first.
            </p>
          )}
        </div>

        {/* Decision form */}
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          <div style={{ backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-xl)", padding: "var(--space-5)" }}>
            <p style={{ margin: "0 0 var(--space-4)", fontSize: "var(--text-xs)", fontWeight: "var(--font-weight-semibold)", color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "var(--tracking-wide)" }}>
              Reviewer details
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
              <div>
                <label htmlFor="reviewer-name" style={labelStyle}>Full name *</label>
                <input id="reviewer-name" type="text" value={reviewerName} onChange={(e) => setReviewerName(e.target.value)} placeholder="Jane Smith" disabled={alreadyDecided} style={inputStyle} />
              </div>
              <div>
                <label htmlFor="reviewer-email" style={labelStyle}>Email *</label>
                <input id="reviewer-email" type="email" value={reviewerEmail} onChange={(e) => setReviewerEmail(e.target.value)} placeholder="j.smith@eu.int" disabled={alreadyDecided} style={inputStyle} />
              </div>
              <div>
                <label htmlFor="comments" style={labelStyle}>Comments <span style={{ fontWeight: "var(--font-weight-regular)", textTransform: "none", letterSpacing: 0 }}>(required for rejection)</span></label>
                <textarea
                  id="comments"
                  value={comments}
                  onChange={(e) => setComments(e.target.value)}
                  placeholder="Add notes or reasons…"
                  disabled={alreadyDecided}
                  rows={4}
                  style={{ ...inputStyle, height: "auto", padding: "var(--space-3) var(--space-4)", resize: "vertical" }}
                />
              </div>
            </div>
          </div>

          {alreadyDecided ? (
            <div style={{ padding: "var(--space-4)", backgroundColor: "var(--color-surface-raised)", borderRadius: "var(--radius-lg)", border: "1px solid var(--color-border)", textAlign: "center" }}>
              <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", textTransform: "capitalize" }}>
                Decision: {reviewState?.review_status}
              </p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
              <button
                type="button"
                onClick={() => approve()}
                disabled={busy || !formValid}
                style={{
                  height: "var(--touch-min)",
                  borderRadius: "var(--radius-btn)",
                  border: "none",
                  backgroundColor: busy || !formValid ? "var(--color-border)" : "var(--color-approved)",
                  color: busy || !formValid ? "var(--color-text-muted)" : "#ffffff",
                  fontSize: "var(--text-sm)",
                  fontWeight: "var(--font-weight-semibold)",
                  cursor: busy || !formValid ? "not-allowed" : "pointer",
                  width: "100%",
                }}
              >
                {approving ? "Approving…" : "✓ Approve"}
              </button>
              <button
                type="button"
                onClick={() => reject()}
                disabled={busy || !formValid || !comments.trim()}
                style={{
                  height: "var(--touch-min)",
                  borderRadius: "var(--radius-btn)",
                  border: "1px solid var(--color-error-border)",
                  backgroundColor: "var(--color-error-bg)",
                  color: busy || !formValid || !comments.trim() ? "var(--color-text-muted)" : "var(--color-error-text)",
                  fontSize: "var(--text-sm)",
                  fontWeight: "var(--font-weight-semibold)",
                  cursor: busy || !formValid || !comments.trim() ? "not-allowed" : "pointer",
                  width: "100%",
                }}
              >
                {rejecting ? "Rejecting…" : "✕ Reject"}
              </button>
              <p style={{ margin: 0, fontSize: "var(--text-xs)", color: "var(--color-text-muted)", textAlign: "center" }}>
                Comments required to reject.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
