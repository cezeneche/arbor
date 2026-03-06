/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  async rewrites() {
    const ledgerUrl = process.env.LEDGER_URL ?? "http://localhost:8000";
    const narrativeUrl = process.env.NARRATIVE_URL ?? "http://localhost:8001";
    return [
      {
        source: "/api-proxy/ledger/:path*",
        destination: `${ledgerUrl}/api/:path*`,
      },
      {
        source: "/api-proxy/narrative/:path*",
        destination: `${narrativeUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
