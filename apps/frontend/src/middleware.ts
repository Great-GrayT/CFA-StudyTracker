import { NextRequest, NextResponse } from "next/server";

// Content Security Policy, with a per-request nonce.
//
// This lives in middleware rather than next.config.ts because Next's own
// bootstrap and hydration data are delivered as INLINE script tags. A static
// `script-src 'self'` blocks every one of them, so the page server-renders and
// then never hydrates: the user gets a blank screen with no console error that
// names the cause. A nonce is the only way to allow exactly those scripts
// without opening the door to every injected one.
//
// The cost is real and worth stating: a per-request nonce means pages cannot
// be served as fully static HTML. That is the price of not falling back to
// 'unsafe-inline', which would make any future XSS directly exploitable.
//
// 'strict-dynamic' lets a nonced script load further scripts it needs (Next
// loads chunks this way), while still refusing anything the page itself did
// not vouch for.

export function middleware(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");

  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    // Styles stay 'unsafe-inline': React sets inline style attributes for the
    // data visualisations (bar widths, fill fractions) and a nonce cannot
    // cover a style attribute, only a <style> tag.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    // Same-origin only. The browser never calls the API directly, it goes
    // through /api/proxy, and Vercel's analytics beacons are same-origin too.
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");

  // Next reads the nonce back off the request headers to stamp onto its own
  // script tags, so it has to be set on the request, not only the response.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("content-security-policy", csp);
  return response;
}

export const config = {
  matcher: [
    // Everything except static assets and the service worker. Those are
    // plain files with no inline scripts, so a nonce buys nothing and the
    // middleware hop would only add latency.
    {
      source: "/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
