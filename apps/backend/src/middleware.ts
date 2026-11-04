import { NextResponse, type NextRequest } from "next/server";

/**
 * Global edge middleware for every `/api/*` request: fail-closed CORS and
 * tiered per-IP rate limiting. Mirrors cron-server's `middleware.ts` shape
 * (same sliding-window-counter rate limiter, same in-memory Map store with
 * its documented Redis follow-up), adapted to this plan's tier budgets and
 * CORS requirement: an origin outside the allow-list is rejected outright
 * (403), not merely left without CORS headers.
 */

export const config = {
  matcher: "/api/:path*",
};

// ---- tiers -------------------------------------------------------------------

interface Tier {
  name: string;
  windowMs: number;
  max: number;
}

const DEFAULT_TIER: Tier = {
  name: "default",
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000),
  max: Number(process.env.RATE_LIMIT_MAX_REQUESTS ?? 240),
};

// Strict budgets for credential/account-creation endpoints. Kept independent
// of DEFAULT_TIER (and of each other) so brute-forcing login can't eat into
// the general allowance, or vice versa.
const LOGIN_TIER: Tier = { name: "login", windowMs: 60_000, max: 10 };
const REGISTER_TIER: Tier = { name: "register", windowMs: 15 * 60_000, max: 5 };

function tierFor(pathname: string): Tier {
  if (pathname === "/api/auth/login" || pathname.startsWith("/api/auth/oauth/")) {
    return LOGIN_TIER;
  }
  if (pathname === "/api/auth/register" || pathname === "/api/auth/forgot-password") {
    return REGISTER_TIER;
  }
  return DEFAULT_TIER;
}

// ---- sliding-window-counter store --------------------------------------------

interface Window {
  windowStart: number; // index of the current window
  count: number; // hits in the current window
  prev: number; // hits in the previous window
}

const windows = new Map<string, Window>();
let lastSweep = 0;

// Opportunistically drop stale keys so the map can't grow unbounded under a
// rotating-IP flood.
function sweep(now: number): void {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, w] of windows) {
    const windowMs = Number(key.split(" ")[2]) || DEFAULT_TIER.windowMs;
    if ((w.windowStart + 2) * windowMs < now) windows.delete(key);
  }
}

/** Sliding-window-counter: estimate = count + prev * (fraction of window left). */
function rateLimited(
  tier: Tier,
  ip: string,
  now: number,
): { limited: boolean; remaining: number; resetAt: number } {
  // Keyed by tier name + IP + window size, so the same IP gets an
  // independent budget per tier - exhausting LOGIN_TIER never touches
  // DEFAULT_TIER's count for that IP, and vice versa.
  const key = `${tier.name} ${ip} ${tier.windowMs}`;
  const cur = Math.floor(now / tier.windowMs);
  const w = windows.get(key);

  if (!w || w.windowStart < cur - 1) {
    windows.set(key, { windowStart: cur, count: 1, prev: 0 });
    return { limited: false, remaining: tier.max - 1, resetAt: (cur + 1) * tier.windowMs };
  }
  if (w.windowStart === cur - 1) {
    // Slid into a new window: last window's count becomes the weighted tail.
    w.prev = w.count;
    w.count = 1;
    w.windowStart = cur;
  } else {
    w.count += 1;
  }
  const elapsedFrac = (now - cur * tier.windowMs) / tier.windowMs;
  const estimate = w.count + w.prev * (1 - elapsedFrac);
  return {
    limited: estimate > tier.max,
    remaining: Math.max(0, Math.floor(tier.max - estimate)),
    resetAt: (cur + 1) * tier.windowMs,
  };
}

function clientIp(req: NextRequest): string {
  // Behind a reverse proxy, these headers carry the real client IP; see
  // SECURITY.md-equivalent notes in cron-server for the trust assumptions.
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}

// ---- CORS (fail-closed) -------------------------------------------------------

const ALLOWED_ORIGINS = (process.env.CORS_ALLOW_ORIGINS ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

function corsHeadersFor(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export function middleware(req: NextRequest): NextResponse {
  const origin = req.headers.get("origin");

  // Fail closed: a request that names an Origin not on the allow-list is
  // rejected outright, not merely sent back without CORS headers (that would
  // still let the request execute server-side, relying only on the browser's
  // same-origin policy to hide the response from the caller).
  if (origin !== null && !ALLOWED_ORIGINS.includes(origin)) {
    return NextResponse.json({ error: "origin not allowed" }, { status: 403 });
  }

  const corsHeaders = origin !== null ? corsHeadersFor(origin) : {};

  // Preflight - answer immediately, no rate-limit charge.
  if (req.method === "OPTIONS") {
    return new NextResponse(null, { status: 204, headers: corsHeaders });
  }

  const now = Date.now();
  sweep(now);
  const tier = tierFor(req.nextUrl.pathname);
  const ip = clientIp(req);
  const { limited, remaining, resetAt } = rateLimited(tier, ip, now);

  const headers = new Headers({
    ...corsHeaders,
    "X-RateLimit-Limit": String(tier.max),
    "X-RateLimit-Remaining": String(remaining),
    "X-RateLimit-Reset": String(Math.ceil(resetAt / 1000)),
  });

  if (limited) {
    headers.set("Retry-After", String(Math.max(1, Math.ceil((resetAt - now) / 1000))));
    return NextResponse.json({ error: "rate limit exceeded" }, { status: 429, headers });
  }

  const res = NextResponse.next();
  headers.forEach((value, key) => res.headers.set(key, value));
  return res;
}
