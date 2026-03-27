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
  title: {
    default:  "Nucleos",
    template: "%s — Nucleos",
  },
  description: "Nucleos turns supplier documents into HMRC returns.",
  icons: {
    icon: "/favicon.svg",
  },
  other: {
    "theme-color": "#1B2F4A",
  },
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
