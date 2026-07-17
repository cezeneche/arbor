import type { NextConfig } from "next";

// Production build gate: these must be present or runtime behaviour silently
// degrades (localhost links in customer emails, unsigned sessions, broken 2FA
// secrets). Failing the build is loud; failing at request time is invisible.
// Only enforced on Vercel *production* builds so local/preview stay unblocked.
if (process.env.VERCEL_ENV === "production") {
  const required = [
    "NEXT_PUBLIC_APP_URL", // canonical external origin for all minted links
    "AUTH_SECRET", // NextAuth JWT signing
    "AUDIT_CHAIN_SECRET", // HMAC audit chain
    "TOTP_ENCRYPTION_KEY", // 2FA secret encryption
  ] as const;
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(
      `Production build blocked — missing required env vars: ${missing.join(", ")}`,
    );
  }
}

// Gap 7a — security headers applied to every response. Table stakes for any
// enterprise procurement / security review (securityheaders.com).
const isDev = process.env.NODE_ENV !== "production";

const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // Next.js requires inline scripts for hydration/styled JSX (kept). 'unsafe-eval'
      // is only needed by the dev HMR runtime, so it is excluded in production to
      // tighten XSS containment.
      `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self' https://*.inngest.com https://*.resend.com https://*.supabase.co https://*.vercel-blob.com https://*.upstash.io https://api.anthropic.com https://api.workos.com",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
