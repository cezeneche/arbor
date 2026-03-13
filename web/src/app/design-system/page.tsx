/**
 * /design-system — Component showcase
 *
 * Every component in all states. Arranged in sections:
 * 1. Tokens (colour palette, spacing, typography)
 * 2. Button (all variants × sizes × states)
 * 3. Badge (all variants)
 * 4. StatusDot (all statuses)
 * 5. Input (all states)
 * 6. AlertBanner (all variants, dismissible)
 * 7. MetricCard (KPI layouts)
 * 8. Card (with header/footer, plain)
 * 9. TopNav (static preview)
 * 10. Sidebar (static preview)
 * 11. PageShell (full layout preview)
 */
"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatusDot } from "@/components/ui/StatusDot";
import { InputField } from "@/components/ui/input";
import { AlertBanner } from "@/components/ui/AlertBanner";
import { MetricCard } from "@/components/ui/MetricCard";
import { TopNav } from "@/components/ui/TopNav";
import {
  Upload,
  Download,
  Trash2,
  Plus,
  Search,
  ArrowRight,
  FileText,
} from "lucide-react";

/* ─── Section wrapper ───────────────────────────────────────────────────── */
function Section({
  title,
  description,
  id,
  children,
}: {
  title: string;
  description?: string;
  id: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="mb-16 scroll-mt-8">
      <div className="mb-6 border-b border-neutral-200 pb-4">
        <h2 className="text-xl font-semibold text-neutral-900">{title}</h2>
        {description && (
          <p className="mt-1 text-base text-neutral-600">{description}</p>
        )}
      </div>
      {children}
    </section>
  );
}

/* ─── Subsection wrapper ────────────────────────────────────────────────── */
function Sub({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-8">
      <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-neutral-400">
        {label}
      </p>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}

/* ─── Colour swatch ─────────────────────────────────────────────────────── */
function Swatch({
  name,
  bg,
  hex,
  contrast,
}: {
  name: string;
  bg: string;
  hex: string;
  contrast?: string;
}) {
  return (
    <div className="flex flex-col gap-1 w-24 flex-shrink-0">
      <div
        className={`h-14 w-full rounded-md border border-neutral-200 ${bg}`}
        title={hex}
      />
      <p className="text-[11px] font-medium text-neutral-800 leading-tight">{name}</p>
      <p className="text-[10px] text-neutral-500 font-mono leading-tight">{hex}</p>
      {contrast && (
        <p className="text-[10px] text-neutral-400 leading-tight">{contrast}</p>
      )}
    </div>
  );
}

/* ─── Table of contents ─────────────────────────────────────────────────── */
const TOC = [
  { label: "Tokens",      id: "tokens" },
  { label: "Buttons",     id: "buttons" },
  { label: "Badges",      id: "badges" },
  { label: "StatusDot",   id: "status-dot" },
  { label: "Inputs",      id: "inputs" },
  { label: "Alerts",      id: "alerts" },
  { label: "MetricCards", id: "metric-cards" },
  { label: "Cards",       id: "cards" },
  { label: "TopNav",      id: "top-nav" },
  { label: "Sidebar",     id: "sidebar" },
];

/* ═══════════════════════════════════════════════════════════════════════════ */
export default function DesignSystemPage() {
  const [inputValue, setInputValue] = useState("");
  const [loadingBtn, setLoadingBtn] = useState(false);

  function handleLoadingDemo() {
    setLoadingBtn(true);
    setTimeout(() => setLoadingBtn(false), 2000);
  }

  return (
    <div className="min-h-screen bg-neutral-50">
      {/* Page header */}
      <div className="bg-neutral-0 border-b border-neutral-200 sticky top-0 z-[100]">
        <div className="max-w-content mx-auto px-6 h-16 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-neutral-900">
              CBAM Portal — Design System
            </h1>
            <p className="text-xs text-neutral-500">
              All components in all states
            </p>
          </div>
          <span className="text-xs bg-teal-50 text-teal-800 border border-teal-200 rounded-full px-3 py-1 font-medium">
            v1.0
          </span>
        </div>
      </div>

      <div className="max-w-content mx-auto px-6 py-10 flex gap-10">
        {/* Sticky table of contents */}
        <aside className="hidden lg:block w-44 flex-shrink-0">
          <nav className="sticky top-24" aria-label="Design system sections">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-neutral-400 mb-3">
              Contents
            </p>
            <ul className="flex flex-col gap-0.5">
              {TOC.map((item) => (
                <li key={item.id}>
                  <a
                    href={`#${item.id}`}
                    className="block h-9 px-3 leading-9 rounded text-sm text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 transition-colors"
                  >
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </aside>

        {/* Main content */}
        <div className="flex-1 min-w-0">

          {/* ── 1. TOKENS ──────────────────────────────────────────── */}
          <Section
            id="tokens"
            title="Design Tokens"
            description="CSS custom properties that form the foundation of the design system."
          >
            <Sub label="Teal (accent colour)">
              <Swatch name="teal-50"  bg="bg-teal-50"  hex="#F0FDFA" />
              <Swatch name="teal-100" bg="bg-teal-100" hex="#CCFBF1" />
              <Swatch name="teal-200" bg="bg-teal-200" hex="#99F6E4" />
              <Swatch name="teal-700" bg="bg-teal-700" hex="#0F766E" contrast="6.3:1 AA" />
              <Swatch name="teal-800" bg="bg-teal-800" hex="#115E59" contrast="8.1:1 AAA" />
              <Swatch name="teal-900" bg="bg-teal-900" hex="#134E4A" />
            </Sub>

            <Sub label="Neutral (warm stone gray)">
              <Swatch name="neutral-0"   bg="bg-neutral-0   border" hex="#FFFFFF" />
              <Swatch name="neutral-50"  bg="bg-neutral-50"  hex="#FAFAF9" />
              <Swatch name="neutral-100" bg="bg-neutral-100" hex="#F5F5F4" />
              <Swatch name="neutral-200" bg="bg-neutral-200" hex="#E7E5E4" />
              <Swatch name="neutral-400" bg="bg-neutral-400" hex="#A8A29E" />
              <Swatch name="neutral-600" bg="bg-neutral-600" hex="#57534E" contrast="7.0:1 AAA" />
              <Swatch name="neutral-900" bg="bg-neutral-900" hex="#1C1917" contrast="16.8:1 AAA" />
            </Sub>

            <Sub label="Semantic status colours">
              <Swatch name="success"    bg="bg-[var(--success-bg)]" hex="#F0FDF4" />
              <Swatch name="success-text" bg="bg-[var(--success-text)]" hex="#166534" contrast="8.6:1 AAA" />
              <Swatch name="warning"    bg="bg-[var(--warning-bg)]" hex="#FFFBEB" />
              <Swatch name="warning-text" bg="bg-[var(--warning-text)]" hex="#92400E" contrast="7.3:1 AAA" />
              <Swatch name="error"      bg="bg-[var(--error-bg)]"   hex="#FEF2F2" />
              <Swatch name="error-text" bg="bg-[var(--error-text)]" hex="#991B1B" contrast="7.1:1 AAA" />
              <Swatch name="info"       bg="bg-[var(--info-bg)]"    hex="#EFF6FF" />
              <Swatch name="info-text"  bg="bg-[var(--info-text)]"  hex="#1E3A8A" contrast="10.4:1 AAA" />
            </Sub>

            <Sub label="Typography scale (min 14px)">
              {[
                ["text-xs",   "14px — xs (minimum)", "text-xs"],
                ["text-sm",   "15px — sm",            "text-sm"],
                ["text-base", "16px — base (body)",   "text-base"],
                ["text-lg",   "18px — lg",            "text-lg"],
                ["text-xl",   "20px — xl",            "text-xl"],
                ["text-2xl",  "24px — 2xl",           "text-2xl"],
              ].map(([label, sample, cls]) => (
                <div key={label} className="flex flex-col gap-1 min-w-[200px]">
                  <span className={`${cls} font-medium text-neutral-900 leading-none`}>
                    {sample}
                  </span>
                  <span className="text-[10px] text-neutral-400 font-mono">{cls}</span>
                </div>
              ))}
            </Sub>
          </Section>

          {/* ── 2. BUTTONS ─────────────────────────────────────────── */}
          <Section
            id="buttons"
            title="Button"
            description="All sizes are min 48×48px. Primary uses teal-700 (6.3:1 WCAG AA). Danger uses red-800 (7.1:1 WCAG AAA)."
          >
            <Sub label="Variants — md size">
              <Button variant="primary">Submit Declaration</Button>
              <Button variant="secondary">Export PDF</Button>
              <Button variant="ghost">Cancel</Button>
              <Button variant="danger">Delete Case</Button>
              <Button variant="danger-outline">Remove Document</Button>
            </Sub>

            <Sub label="With icons">
              <Button variant="primary"><Upload size={16} /> Upload Document</Button>
              <Button variant="secondary"><Download size={16} /> Export</Button>
              <Button variant="ghost"><Search size={16} /> Search</Button>
              <Button variant="danger"><Trash2 size={16} /> Delete</Button>
            </Sub>

            <Sub label="Sizes">
              <Button size="sm">Small</Button>
              <Button size="md">Medium</Button>
              <Button size="lg">Large</Button>
              <Button size="icon" aria-label="Add new item"><Plus /></Button>
            </Sub>

            <Sub label="States">
              <Button variant="primary" disabled>Disabled</Button>
              <Button
                variant="primary"
                loading={loadingBtn}
                loadingText="Submitting…"
                onClick={handleLoadingDemo}
              >
                {loadingBtn ? "Submitting…" : "Click to load"}
              </Button>
              <Button variant="link">Link button</Button>
              <Button variant="secondary" size="sm">
                Next step <ArrowRight size={14} />
              </Button>
            </Sub>

            <Sub label="Accessibility note">
              <p className="text-sm text-neutral-600 w-full">
                All interactive states (hover, focus, active, disabled) are distinguishable
                without relying on colour alone. Focus ring is 3px teal-400 (WCAG 3:1
                against white background). Disabled buttons retain their text label.
              </p>
            </Sub>
          </Section>

          {/* ── 3. BADGES ──────────────────────────────────────────── */}
          <Section
            id="badges"
            title="Badge"
            description="Domain metadata pills. Three variants covering CBAM calculation methods, commodity sectors, and reporting periods."
          >
            <Sub label="Calculation method">
              <Badge variant="method" label="Actual" />
              <Badge variant="method" label="Estimated" />
              <Badge variant="method" label="Annex VI Default" />
            </Sub>

            <Sub label="Commodity sector">
              <Badge variant="sector" label="Cement" />
              <Badge variant="sector" label="Iron & Steel" />
              <Badge variant="sector" label="Aluminium" />
              <Badge variant="sector" label="Fertilisers" />
              <Badge variant="sector" label="Electricity" />
            </Sub>

            <Sub label="Reporting period">
              <Badge variant="quarter" label="Q1 2024" />
              <Badge variant="quarter" label="Q2 2024" />
              <Badge variant="quarter" label="Q3 2025" />
            </Sub>
          </Section>

          {/* ── 4. STATUS DOT ──────────────────────────────────────── */}
          <Section
            id="status-dot"
            title="StatusDot"
            description="Inline status indicator for list rows. Dot colour + text label — never colour alone. WCAG AAA contrast on dark surface."
          >
            <Sub label="All statuses">
              <StatusDot status="approved" />
              <StatusDot status="pending" />
              <StatusDot status="processing" />
              <StatusDot status="error" />
              <StatusDot status="flagged" />
            </Sub>

            <Sub label="Sizes">
              <StatusDot status="approved" size="sm" label="Small (table row)" />
              <StatusDot status="approved" size="md" label="Medium (page header)" />
            </Sub>

            <Sub label="In a realistic case list">
              <div style={{ width: "100%", border: "1px solid var(--color-border)", borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
                {[
                  { ref: "CBAM-2024-Q2-001", importer: "Acme Steel Ltd",    status: "approved"   as const },
                  { ref: "CBAM-2024-Q2-002", importer: "Euro Cement GmbH",  status: "pending"    as const },
                  { ref: "CBAM-2024-Q2-003", importer: "Nordic Aluminium",  status: "flagged"    as const },
                  { ref: "CBAM-2024-Q3-001", importer: "Baltic Fertilisers",status: "processing" as const },
                ].map((row, i, arr) => (
                  <div
                    key={row.ref}
                    style={{
                      display: "flex", alignItems: "center", gap: "var(--space-4)",
                      padding: "var(--space-3) var(--space-4)",
                      borderBottom: i < arr.length - 1 ? "1px solid var(--color-border)" : "none",
                      backgroundColor: "var(--color-surface)",
                    }}
                  >
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--color-text-muted)", minWidth: "160px" }}>{row.ref}</span>
                    <span style={{ flex: 1, fontSize: "var(--text-sm)", color: "var(--color-text-primary)" }}>{row.importer}</span>
                    <StatusDot status={row.status} size="sm" />
                  </div>
                ))}
              </div>
            </Sub>
          </Section>

          {/* ── 5. INPUTS ──────────────────────────────────────────── */}
          <Section
            id="inputs"
            title="Input"
            description="All inputs are min 48px height and 16px font (prevents iOS auto-zoom). Labels are always visible. Errors use text + border colour."
          >
            <Sub label="Default">
              <div className="w-full max-w-sm">
                <InputField
                  id="eori-default"
                  label="Importer EORI Number"
                  placeholder="GB123456789000"
                  hint="Your EU Customs Economic Operators Registration and Identification number."
                />
              </div>
            </Sub>

            <Sub label="Required field">
              <div className="w-full max-w-sm">
                <InputField
                  id="eori-required"
                  label="Importer EORI Number"
                  placeholder="GB123456789000"
                  required
                />
              </div>
            </Sub>

            <Sub label="Error state">
              <div className="w-full max-w-sm">
                <InputField
                  id="eori-error"
                  label="Importer EORI Number"
                  value="INVALID"
                  error="EORI number must start with a two-letter country code followed by digits (e.g. GB123456789000)."
                  onChange={() => {}}
                />
              </div>
            </Sub>

            <Sub label="Disabled">
              <div className="w-full max-w-sm">
                <InputField
                  id="eori-disabled"
                  label="Importer EORI Number"
                  value="GB123456789000"
                  disabled
                />
              </div>
            </Sub>

            <Sub label="Controlled input">
              <div className="w-full max-w-sm">
                <InputField
                  id="search-controlled"
                  label="Search cases"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  placeholder="Case reference, importer, CN code…"
                />
              </div>
            </Sub>
          </Section>

          {/* ── 6. ALERT BANNERS ───────────────────────────────────── */}
          <Section
            id="alerts"
            title="AlertBanner"
            description="Page-level notifications. Never dismissible — users must act. Three visual channels: icon shape + colour + text. role=alert for error/warning."
          >
            <Sub label="All severities">
              <div className="flex flex-col gap-4 w-full">
                <AlertBanner
                  severity="info"
                  message="CBAM transitional period active. Quarterly reports due within one month of each quarter end."
                  ctaLabel="View schedule"
                  onCta={() => {}}
                />
                <AlertBanner
                  severity="warning"
                  message="3 goods lines require attention. Confidence scores below threshold — supplier data needed or Annex VI defaults will apply."
                  ctaLabel="Review lines"
                  onCta={() => {}}
                />
                <AlertBanner
                  severity="error"
                  message="Submission blocked. One or more required fields are missing. Review the flagged items before attempting to submit."
                  ctaLabel="Show errors"
                  onCta={() => {}}
                />
              </div>
            </Sub>
          </Section>

          {/* ── 7. METRIC CARDS ────────────────────────────────────── */}
          <Section
            id="metric-cards"
            title="MetricCard"
            description="KPI display: muted uppercase label above, large value, optional unit and trend. Alert state adds amber left border."
          >
            <Sub label="KPI grid">
              <div className="w-full grid grid-cols-2 lg:grid-cols-4 gap-4">
                <MetricCard label="Total CO₂e" value="8,700" unit="kgCO₂e" trend="down" />
                <MetricCard label="Active Cases" value={12} trend="up" />
                <MetricCard label="Goods Lines" value={47} unit="lines" />
                <MetricCard label="Data Quality" value="84%" trend="up" alert />
              </div>
            </Sub>

            <Sub label="Clickable cards">
              <div className="grid grid-cols-2 gap-4 w-full max-w-lg">
                <MetricCard label="Pending Review" value={3} alert onClick={() => {}} />
                <MetricCard label="CBAM Cost" value="€4,350" unit="est." onClick={() => {}} />
              </div>
            </Sub>

            <Sub label="Trend directions">
              <div className="grid grid-cols-3 gap-4 w-full max-w-2xl">
                <MetricCard label="Trending up"   value="72%" trend="up" />
                <MetricCard label="Trending down"  value="23%" trend="down" />
                <MetricCard label="No change"     value="Stable" trend="neutral" />
              </div>
            </Sub>
          </Section>

          {/* ── 8. CARDS ───────────────────────────────────────────── */}
          <Section
            id="cards"
            title="Card"
            description="Container for grouped content. White background on off-white page provides depth via colour contrast, not shadow weight."
          >
            <Sub label="With header, content, footer">
              <div className="w-full max-w-md">
                <Card>
                  <CardHeader>
                    <CardTitle>CBAM Case — Q2 2024</CardTitle>
                    <CardDescription>
                      Reporting period: 1 April – 30 June 2024 · EORI: GB123456789000
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-col gap-3">
                      <div className="flex justify-between text-sm">
                        <span className="text-neutral-600">Total shipments</span>
                        <span className="font-medium text-neutral-900">6</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-neutral-600">Goods lines</span>
                        <span className="font-medium text-neutral-900">24</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-neutral-600">Total embedded CO₂e</span>
                        <span className="font-medium text-neutral-900">8,700 kgCO₂e</span>
                      </div>
                    </div>
                  </CardContent>
                  <CardFooter>
                    <Button size="sm" variant="primary">View declaration</Button>
                    <Button size="sm" variant="ghost">Download PDF</Button>
                  </CardFooter>
                </Card>
              </div>
            </Sub>

            <Sub label="Plain card (no header/footer)">
              <div className="w-full max-w-md">
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-start gap-4">
                      <div className="flex items-center justify-center w-10 h-10 rounded bg-teal-50 text-teal-700 flex-shrink-0">
                        <FileText size={20} aria-hidden="true" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-neutral-900">invoice_q2_2024.pdf</p>
                        <p className="text-xs text-neutral-500 mt-1">Uploaded 12 March 2026 · 2.3 MB</p>
                        <p className="text-xs text-neutral-600 mt-2">
                          Extraction complete — 8 goods lines, 1 warning (repair_failed:incoterm)
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </Sub>

            <Sub label="Multiple cards in a grid">
              <div className="w-full grid grid-cols-1 sm:grid-cols-2 gap-4">
                {[
                  { title: "Upload Documents", desc: "Upload supplier invoices, mill certificates, or customs declarations.", icon: Upload },
                  { title: "Track Cases", desc: "Monitor your CBAM compliance cases across all reporting quarters.", icon: FileText },
                ].map((item) => (
                  <Card key={item.title} className="cursor-pointer hover:shadow-md hover:border-neutral-300 transition-shadow">
                    <CardContent className="pt-6">
                      <div className="flex gap-3">
                        <item.icon className="text-teal-700 flex-shrink-0 mt-0.5" size={20} aria-hidden="true" />
                        <div>
                          <p className="text-sm font-semibold text-neutral-900">{item.title}</p>
                          <p className="text-xs text-neutral-600 mt-1 leading-relaxed">{item.desc}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </Sub>
          </Section>

          {/* ── 9. TOP NAV ─────────────────────────────────────────── */}
          <Section
            id="top-nav"
            title="TopNav"
            description="Sticky, 64px height. White background with bottom border. User menu, notification bell (48×48px touch targets)."
          >
            <Sub label="Static preview">
              <div className="w-full rounded-lg overflow-hidden border border-neutral-200 shadow-sm">
                <TopNav
                  userName="Chisom Okafor"
                  userEmail="chisom@acme-imports.co.uk"
                  notificationCount={3}
                />
              </div>
            </Sub>
            <Sub label="No notifications">
              <div className="w-full rounded-lg overflow-hidden border border-neutral-200 shadow-sm">
                <TopNav userName="Jane Smith" userEmail="jane@eurocement.de" notificationCount={0} />
              </div>
            </Sub>
          </Section>

          {/* ── 10. SIDEBAR ────────────────────────────────────────── */}
          <Section
            id="sidebar"
            title="AppSidebar"
            description="240px width. Active item: 3 visual cues (bg colour + text colour + left border). aria-current=page on active link."
          >
            <Sub label="Static preview (simulated active on CBAM Cases)">
              <div
                className="relative rounded-lg overflow-hidden border border-neutral-200 shadow-sm"
                style={{ height: 480 }}
              >
                {/* We render the sidebar in a contained div for preview   */}
                <div className="flex h-full">
                  <nav
                    className="flex flex-col h-full w-60 bg-neutral-0 border-r border-neutral-200 py-4 overflow-y-auto"
                    aria-label="Sidebar preview"
                  >
                    {[
                      { label: "Dashboard",        active: false, indent: false },
                      { label: "CBAM Cases",        active: true,  indent: true,  group: "Compliance" },
                      { label: "Upload Documents",  active: false, indent: true },
                      { label: "Shipments",         active: false, indent: true },
                      { label: "Emissions Data",    active: false, indent: true,  group: "Reporting" },
                      { label: "Narratives",        active: false, indent: true },
                      { label: "Audit Log",         active: false, indent: true },
                      { label: "Settings",          active: false, indent: true,  group: "Account" },
                      { label: "Help & Guidance",   active: false, indent: true },
                    ].map((item) => (
                      <React.Fragment key={item.label}>
                        {item.group && (
                          <p className="px-6 pt-4 pb-1 text-[11px] font-semibold uppercase tracking-widest text-neutral-400">
                            {item.group}
                          </p>
                        )}
                        <div
                          className={[
                            "flex items-center gap-3 h-12 mx-3 px-3 rounded-md text-sm font-medium cursor-default",
                            item.active
                              ? "bg-teal-50 text-teal-800 border-l-[3px] border-l-teal-700"
                              : "text-neutral-700",
                          ].join(" ")}
                        >
                          <span className="w-4 h-4 rounded-sm bg-current opacity-40 flex-shrink-0" aria-hidden="true" />
                          {item.label}
                        </div>
                      </React.Fragment>
                    ))}
                  </nav>
                  <div className="flex-1 bg-neutral-50 p-6">
                    <p className="text-sm text-neutral-500 italic">Page content area</p>
                  </div>
                </div>
              </div>
            </Sub>
          </Section>

          {/* ── FOOTER NOTE ─────────────────────────────────────────── */}
          <div className="mt-16 pt-8 border-t border-neutral-200">
            <div className="flex flex-col gap-2">
              <p className="text-sm font-semibold text-neutral-700">Design System Notes</p>
              <ul className="text-sm text-neutral-600 leading-relaxed space-y-1 list-disc list-inside">
                <li>All interactive elements: min 48×48px touch targets (WCAG 2.5.5)</li>
                <li>All text: minimum 14px (xs), body default 16px</li>
                <li>All colours: WCAG AA minimum on backgrounds; AAA wherever practical</li>
                <li>Status communicated via text label + colour + shape (three channels)</li>
                <li>Focus ring: 3px teal-400, visible on all interactive elements</li>
                <li>Reduced-motion: all transitions disabled via prefers-reduced-motion</li>
                <li>Font: system-ui stack — no external font requests, instant load</li>
                <li>Accent: single colour (teal) — institutional, not consumer</li>
              </ul>
            </div>
          </div>

        </div>{/* end main content */}
      </div>{/* end flex */}
    </div>
  );
}
