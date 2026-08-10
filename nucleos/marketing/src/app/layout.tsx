import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://nucleos.co.uk",
  ),
  title: {
    default: "nucleos: CBAM compliance, calculated",
    template: "%s | nucleos",
  },
  description:
    "nucleos reads your supply chain documents and calculates the carbon price of your imports. UK and EU CBAM compliance software for importers.",
  keywords: [
    "CBAM",
    "Carbon Border Adjustment Mechanism",
    "UK CBAM",
    "EU CBAM",
    "HMRC CBAM",
    "CBAM compliance software",
    "carbon compliance",
    "embedded emissions",
    "CBAM return",
    "CBAM calculator",
  ],
  authors: [{ name: "Nucleos Compliance Ltd" }],
  openGraph: {
    type: "website",
    locale: "en_GB",
    siteName: "nucleos",
    title: "nucleos: CBAM compliance, calculated",
    description:
      "nucleos reads your supply chain documents and calculates the carbon price of your imports.",
  },
  twitter: {
    card: "summary_large_image",
    title: "nucleos: CBAM compliance, calculated",
    description:
      "nucleos reads your supply chain documents and calculates the carbon price of your imports.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en-GB">
      <body>{children}</body>
    </html>
  );
}
