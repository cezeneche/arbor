import type { Metadata } from "next";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { ScopeCheckerTool } from "./ScopeCheckerTool";

export const metadata: Metadata = {
  title: "CBAM Scope Checker — Is your CN code in scope?",
  description:
    "Enter your CN commodity code and estimated annual import value to find out immediately whether UK or EU CBAM applies, what your estimated liability is, and when you need to register.",
};

export default function ScopeCheckerPage() {
  return (
    <>
      <Nav />

      <section
        className="section-sm"
        style={{ borderBottom: "0.5px solid var(--color-border)", backgroundColor: "var(--color-surface)" }}
      >
        <div className="page-content">
          <p
            className="text-xs text-text-tertiary mb-4"
            style={{ letterSpacing: "0.1em" }}
          >
            FREE TOOL
          </p>
          <h1
            className="text-lg text-text-primary mb-3"
            style={{ fontWeight: 500, letterSpacing: "-0.01em" }}
          >
            CBAM scope checker
          </h1>
          <p className="text-sm text-text-secondary max-w-[560px]" style={{ lineHeight: 1.7 }}>
            Enter your 8-digit CN commodity code and your estimated annual import value.
            We&apos;ll tell you whether UK or EU CBAM applies, your estimated liability,
            and what you need to do next. No account required.
          </p>
        </div>
      </section>

      <section className="section" style={{ backgroundColor: "var(--color-bg)" }}>
        <div className="page-content">
          <ScopeCheckerTool />
        </div>
      </section>

      <Footer />
    </>
  );
}
