import { withSentryConfig } from "@sentry/nextjs";

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",

  async rewrites() {
    const ledgerUrl    = process.env.LEDGER_URL    ?? "http://localhost:8000";
    const narrativeUrl = process.env.NARRATIVE_URL ?? ledgerUrl;

    return [
      {
        source:      "/api-proxy/ledger/:path*",
        destination: `${ledgerUrl}/:path*`,
      },
      {
        source:      "/api-proxy/narrative/:path*",
        destination: `${narrativeUrl}/:path*`,
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: !process.env.CI,
  widenClientFileUpload: true,
  hideSourceMaps: true,
  webpack: {
    treeshake: { removeDebugLogging: true },
  },
});
