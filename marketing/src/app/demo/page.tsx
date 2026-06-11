"use client";

import { useState } from "react";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/Button";

const sectors = [
  "Iron & steel",
  "Aluminium",
  "Cement",
  "Fertilisers",
  "Hydrogen",
  "Multiple sectors",
  "Not sure yet",
];

const enquiryTypes = [
  "Product demo",
  "Pricing question",
  "Technical question",
  "Enterprise / custom requirement",
  "Accountant or tax agent access",
];

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        className="block text-xs text-text-secondary mb-2"
        style={{ fontWeight: 500 }}
      >
        {label}
        {required && (
          <span className="text-red ml-1" aria-hidden>
            *
          </span>
        )}
      </label>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  height: "var(--input-height)",
  border: "0.5px solid var(--color-border)",
  borderRadius: "var(--input-radius)",
  paddingLeft: "var(--space-16)",
  paddingRight: "var(--space-16)",
  fontSize: "var(--text-base)",
  fontWeight: "var(--font-body)",
  fontFamily: "var(--font-inter)",
  color: "var(--color-text-primary)",
  backgroundColor: "var(--color-bg)",
  outline: "none",
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  appearance: "none",
  cursor: "pointer",
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%236E6E6A' stroke-width='1.5'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
  backgroundRepeat: "no-repeat",
  backgroundPosition: "right 12px center",
  paddingRight: "40px",
};

export default function DemoPage() {
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [form, setForm] = useState({
    name: "",
    email: "",
    company: "",
    role: "",
    sector: "",
    enquiry: "",
    message: "",
  });

  function update(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    const body = [
      `Name: ${form.name}`,
      `Email: ${form.email}`,
      form.company ? `Company: ${form.company}` : null,
      form.role ? `Role: ${form.role}` : null,
      form.sector ? `Sector: ${form.sector}` : null,
      form.enquiry ? `Enquiry type: ${form.enquiry}` : null,
      form.message ? `\nMessage:\n${form.message}` : null,
    ]
      .filter(Boolean)
      .join("\n");
    window.location.href = `mailto:hello@nucleos.co.uk?subject=${encodeURIComponent(`Demo request: ${form.name}`)}&body=${encodeURIComponent(body)}`;
    setStatus("sent");
  }

  if (status === "sent") {
    return (
      <>
        <Nav />
        <section className="section bg-surface">
          <div className="page-content max-w-[480px]">
            <div
              className="rounded-card p-12"
              style={{ border: "0.5px solid var(--color-border)", boxShadow: "var(--card-shadow)" }}
            >
              <p className="text-xs text-green mb-6" style={{ fontWeight: 500, letterSpacing: "0.08em" }}>
                ✓ RECEIVED
              </p>
              <h1
                className="text-lg text-text-primary mb-4"
                style={{ fontWeight: 500, letterSpacing: "-0.01em" }}
              >
                We&apos;ll be in touch within one business day.
              </h1>
              <p className="text-sm text-text-secondary mb-8" style={{ lineHeight: 1.7 }}>
                If you included a document for the pipeline demo, we&apos;ll run it through
                and send you the extraction output and liability estimate before the call.
              </p>
              <Button href="/" variant="ghost">
                ← Back to home
              </Button>
            </div>
          </div>
        </section>
        <Footer />
      </>
    );
  }

  return (
    <>
      <Nav />

      {/* Header */}
      <section
        className="section-sm bg-surface"
        style={{ borderBottom: "0.5px solid var(--color-border)" }}
      >
        <div className="page-content">
          <p
            className="text-xs text-text-tertiary mb-4"
            style={{ letterSpacing: "0.1em" }}
          >
            CONTACT
          </p>
          <h1
            className="text-lg text-text-primary mb-3"
            style={{ fontWeight: 500, letterSpacing: "-0.01em" }}
          >
            Request a demo.
          </h1>
          <p className="text-sm text-text-secondary max-w-[480px]" style={{ lineHeight: 1.7 }}>
            Tell us about your import profile and we&apos;ll arrange a call. If you have
            a real supplier document you&apos;d like us to run through the pipeline,
            mention it in the message; we&apos;ll do it before the demo.
          </p>
        </div>
      </section>

      <section className="section" style={{ backgroundColor: "var(--color-bg)" }}>
        <div className="page-content">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-16 items-start">
            {/* Form */}
            <div
              className="bg-surface rounded-card p-8"
              style={{ border: "0.5px solid var(--color-border)", boxShadow: "var(--card-shadow)" }}
            >
              <form onSubmit={handleSubmit} className="flex flex-col gap-6">
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Full name" required>
                    <input
                      type="text"
                      required
                      autoComplete="name"
                      value={form.name}
                      onChange={(e) => update("name", e.target.value)}
                      style={inputStyle}
                    />
                  </Field>
                  <Field label="Work email" required>
                    <input
                      type="email"
                      required
                      autoComplete="email"
                      value={form.email}
                      onChange={(e) => update("email", e.target.value)}
                      style={inputStyle}
                    />
                  </Field>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <Field label="Company">
                    <input
                      type="text"
                      autoComplete="organization"
                      value={form.company}
                      onChange={(e) => update("company", e.target.value)}
                      style={inputStyle}
                    />
                  </Field>
                  <Field label="Your role">
                    <input
                      type="text"
                      value={form.role}
                      onChange={(e) => update("role", e.target.value)}
                      style={inputStyle}
                      placeholder="e.g. Head of Finance"
                    />
                  </Field>
                </div>

                <Field label="Primary CBAM sector">
                  <select
                    value={form.sector}
                    onChange={(e) => update("sector", e.target.value)}
                    style={selectStyle}
                  >
                    <option value="">Select a sector</option>
                    {sectors.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="Enquiry type">
                  <select
                    value={form.enquiry}
                    onChange={(e) => update("enquiry", e.target.value)}
                    style={selectStyle}
                  >
                    <option value="">Select one</option>
                    {enquiryTypes.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="Message">
                  <textarea
                    value={form.message}
                    onChange={(e) => update("message", e.target.value)}
                    placeholder="Tell us about your import profile, your current compliance process, or what you'd like to see in the demo."
                    rows={5}
                    style={{
                      ...inputStyle,
                      height: "auto",
                      paddingTop: "var(--space-16)",
                      paddingBottom: "var(--space-16)",
                      resize: "vertical",
                    }}
                  />
                </Field>

                {status === "error" && (
                  <p className="text-sm text-red">
                    Something went wrong. Please email us directly at hello@nucleos.co.uk.
                  </p>
                )}

                <Button
                  type="submit"
                  variant="primary"
                  disabled={status === "sending"}
                >
                  {status === "sending" ? "Sending…" : "Send request"}
                </Button>

                <p className="text-xs text-text-tertiary">
                  We respond within one business day. No sales sequences. A person reads every message.
                </p>
              </form>
            </div>

            {/* What to expect */}
            <div className="flex flex-col gap-8">
              <div>
                <p
                  className="text-xs text-text-tertiary mb-6"
                  style={{ letterSpacing: "0.1em" }}
                >
                  WHAT HAPPENS NEXT
                </p>
                <div
                  className="flex flex-col"
                  style={{ borderTop: "0.5px solid var(--color-border)" }}
                >
                  {[
                    {
                      step: "01",
                      text: "We read your message and check whether you have a document you'd like us to run through the pipeline.",
                    },
                    {
                      step: "02",
                      text: "We run your document through extraction, arbitration, and the calculation engine and prepare the output to walk through with you.",
                    },
                    {
                      step: "03",
                      text: "We schedule a 30-minute call: no slides, just your data in the product.",
                    },
                    {
                      step: "04",
                      text: "You decide whether nucleos is right for your situation. No pressure, no automatic follow-up sequences.",
                    },
                  ].map((s) => (
                    <div
                      key={s.step}
                      className="flex gap-6 py-6"
                      style={{ borderBottom: "0.5px solid var(--color-border)" }}
                    >
                      <p
                        className="text-xs text-text-tertiary shrink-0"
                        style={{ letterSpacing: "0.1em", minWidth: "24px" }}
                      >
                        {s.step}
                      </p>
                      <p className="text-sm text-text-secondary" style={{ lineHeight: 1.7 }}>
                        {s.text}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              <div
                className="bg-surface rounded-card p-8"
                style={{ border: "0.5px solid var(--color-border)" }}
              >
                <p className="text-xs text-text-tertiary mb-3" style={{ letterSpacing: "0.08em" }}>
                  FREE SCOPE CHECK
                </p>
                <p className="text-sm text-text-secondary mb-4" style={{ lineHeight: 1.7 }}>
                  If you just want to know whether your CN code is in scope and what your
                  estimated liability, use the free scope checker. No call needed.
                </p>
                <Button href="/scope-checker" variant="ghost" size="sm">
                  Check your CN code →
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </>
  );
}
