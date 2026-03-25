/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",

  async rewrites() {
    const ledgerUrl    = process.env.LEDGER_URL    ?? "http://localhost:8000";
    const narrativeUrl = process.env.NARRATIVE_URL ?? "http://localhost:8001";

    return [
      // /api-proxy/ledger/api/auth/token  →  http://localhost:8000/api/auth/token
      {
        source:      "/api-proxy/ledger/:path*",
        destination: `${ledgerUrl}/:path*`,
      },
      // /api-proxy/narrative/...  →  http://localhost:8001/...
      {
        source:      "/api-proxy/narrative/:path*",
        destination: `${narrativeUrl}/:path*`,
      },
    ];
  },
};

export default nextConfig;
