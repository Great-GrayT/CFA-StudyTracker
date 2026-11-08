import type { NextConfig } from "next";

// Content Security Policy.
//
// `script-src` carries 'unsafe-inline', and that is a deliberate, bounded
// decision rather than an oversight. Next delivers its bootstrap and
// hydration data as inline script tags. The alternatives were both worse:
//
//   - `script-src 'self'` alone blocks them, which blanked every page in
//     production while still returning a 200 with a full HTML body.
//   - A per-request nonce cannot work here, because most routes are
//     statically prerendered and their HTML is fixed at build time, so no
//     nonce attribute can be stamped onto it. Making every route dynamic to
//     allow one costs a serverless invocation per page view.
//
// What still protects the app, and why this is bounded rather than a blanket
// weakening:
//
//   - The session token lives in an httpOnly cookie, so injected script
//     cannot read it. That was the whole argument for the proxy.
//   - `connect-src 'self'` means injected script has nowhere to send
//     anything it does scrape. Exfiltration is the step this blocks.
//   - No third-party script origin is allowed at all, and the app renders no
//     user-supplied HTML (no dangerouslySetInnerHTML anywhere).
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
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
