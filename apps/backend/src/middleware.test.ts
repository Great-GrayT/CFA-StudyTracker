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
