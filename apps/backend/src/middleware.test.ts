import { test, expect } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "./middleware";

function requestWithOrigin(origin: string): NextRequest {
  return new NextRequest("http://localhost/api/some-resource", {
    method: "GET",
    headers: { origin },
  });
}

function loginRequestFrom(ip: string): NextRequest {
  return new NextRequest("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "x-forwarded-for": ip },
  });
}

// A spoofable X-Forwarded-For alongside a fixed CF-Connecting-IP: the real
// IP (what Cloudflare itself reports) must win so rotating the forwarded-for
// header on every request cannot be used to dodge the per-IP rate limit.
function loginRequestFromBehindCloudflare(cfIp: string, spoofedForwardedFor: string): NextRequest {
  return new NextRequest("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "cf-connecting-ip": cfIp, "x-forwarded-for": spoofedForwardedFor },
  });
}

test("rejects a request from an origin not in CORS_ALLOW_ORIGINS", () => {
  const res = middleware(requestWithOrigin("https://evil.example.com"));
  expect(res.status).toBe(403);
});

test("allows a request from an origin in CORS_ALLOW_ORIGINS", () => {
  const res = middleware(requestWithOrigin(process.env.CORS_ALLOW_ORIGINS!.split(",")[0]!));
  expect(res.status).not.toBe(403);
});

test("blocks the login tier after its budget is exceeded", () => {
  const ip = "1.2.3.4";
  for (let i = 0; i < 10; i++) expect(middleware(loginRequestFrom(ip)).status).not.toBe(429);
  expect(middleware(loginRequestFrom(ip)).status).toBe(429);
});

test("keys the rate limit on CF-Connecting-IP, not a spoofable X-Forwarded-For", () => {
  const cfIp = "9.9.9.9";
  for (let i = 0; i < 10; i++) {
    // A fresh X-Forwarded-For on every request must not reset the budget:
    // the fixed CF-Connecting-IP is what gets keyed.
    expect(middleware(loginRequestFromBehindCloudflare(cfIp, `10.0.0.${i}`)).status).not.toBe(429);
  }
  expect(middleware(loginRequestFromBehindCloudflare(cfIp, "10.0.0.99")).status).toBe(429);
});
