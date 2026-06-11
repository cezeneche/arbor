import Link from "next/link";

const product = [
  { label: "How it works", href: "/how-it-works" },
  { label: "Scope checker", href: "/scope-checker" },
  { label: "Pricing", href: "/pricing" },
  { label: "Request a demo", href: "/demo" },
];

const resources = [
  { label: "CBAM resources", href: "/resources" },
  { label: "UK vs EU CBAM", href: "/resources/uk-vs-eu-cbam" },
  { label: "Registration guide", href: "/resources/registration" },
  { label: "Sector overview", href: "/resources/sectors" },
];

const company = [
  { label: "About", href: "/about" },
  { label: "Contact", href: "/demo" },
];

const legal = [
  { label: "Privacy policy", href: "/privacy" },
  { label: "Terms of service", href: "/terms" },
];

export function Footer() {
  return (
    <footer style={{ backgroundColor: "var(--color-footer-bg)" }}>
      <div className="page-content py-16">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-12 mb-16">
          {/* Brand column */}
          <div className="col-span-2">
            <p
              className="text-text-primary text-base mb-3"
              style={{ fontWeight: 300, letterSpacing: "-0.02em" }}
            >
              nucleos
            </p>
            <p className="text-text-secondary text-sm mb-6 max-w-[240px]">
              nucleos reads your supplier documents and calculates exactly what you owe under UK and EU CBAM.
            </p>
            <p className="text-text-tertiary text-xs">
              Nucleos Compliance Ltd
            </p>
          </div>

          {/* Product */}
          <div>
            <p className="text-xs text-text-tertiary mb-4" style={{ letterSpacing: "0.08em" }}>
              PRODUCT
            </p>
            <ul className="flex flex-col gap-3">
              {product.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="text-sm text-text-secondary hover:text-text-primary transition-colors">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Resources */}
          <div>
            <p className="text-xs text-text-tertiary mb-4" style={{ letterSpacing: "0.08em" }}>
              RESOURCES
            </p>
            <ul className="flex flex-col gap-3">
              {resources.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="text-sm text-text-secondary hover:text-text-primary transition-colors">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Company */}
          <div>
            <p className="text-xs text-text-tertiary mb-4" style={{ letterSpacing: "0.08em" }}>
              COMPANY
            </p>
            <ul className="flex flex-col gap-3">
              {company.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="text-sm text-text-secondary hover:text-text-primary transition-colors">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="divider mb-8" />

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <p className="text-xs text-text-tertiary">
            © {new Date().getFullYear()} Nucleos Compliance Ltd. All rights reserved.
          </p>
          <div className="flex gap-6">
            {legal.map((l) => (
              <Link key={l.href} href={l.href} className="text-xs text-text-tertiary hover:text-text-secondary transition-colors">
                {l.label}
              </Link>
            ))}
          </div>
        </div>

        <p className="text-xs text-text-tertiary mt-6 max-w-[640px]">
          nucleos is a calculation and reporting tool. Nothing on this site constitutes tax or legal advice.
          CBAM liability calculations depend on verified supplier data and HMRC's published quarterly rate.
        </p>
      </div>
    </footer>
  );
}
