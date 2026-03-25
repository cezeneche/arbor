import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/Providers";

const inter = Inter({
  subsets: ["latin"],
  weight:  ["300", "500"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title:       "Nucleos — CBAM Compliance",
  description: "Carbon Border Adjustment Mechanism compliance platform for UK and EU importers",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
