import type { NextConfig } from "next";

// The CSP is NOT here. It needs a per-request nonce to allow Next's own
// inline bootstrap scripts, and a static header cannot carry one, so it lives
// in src/middleware.ts. A static `script-src 'self'` blocked those scripts and
// left every page blank after server render.

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
