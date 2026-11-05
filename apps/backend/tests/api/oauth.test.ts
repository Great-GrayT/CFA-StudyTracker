import { test, expect } from "vitest";
import { jsonRequest } from "../helpers/request";
import { GET } from "../../src/app/api/auth/oauth/[provider]/route";

test("GET /api/auth/oauth/google redirects to Google's authorization URL with the configured client id", async () => {
  const res = await GET(jsonRequest("GET", "/api/auth/oauth/google"), { params: { provider: "google" } });
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toContain(process.env.GOOGLE_CLIENT_ID);
});

test("an unknown provider returns 404", async () => {
  const res = await GET(jsonRequest("GET", "/api/auth/oauth/facebook"), { params: { provider: "facebook" } });
  expect(res.status).toBe(404);
});
