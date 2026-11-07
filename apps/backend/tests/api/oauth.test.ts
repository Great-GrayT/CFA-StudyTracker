import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { resetDb } from "../helpers/test-db";
import { jsonRequest } from "../helpers/request";
import { GET } from "../../src/app/api/auth/oauth/[provider]/route";
import { GET as CALLBACK_GET } from "../../src/app/api/auth/oauth/[provider]/callback/route";

beforeEach(resetDb);

afterEach(() => {
  vi.restoreAllMocks();
});

test("GET /api/auth/oauth/google redirects to Google's authorization URL with the configured client id", async () => {
  const res = await GET(jsonRequest("GET", "/api/auth/oauth/google"), { params: Promise.resolve({ provider: "google" }) });
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toContain(process.env.GOOGLE_CLIENT_ID);
});

test("an unknown provider returns 404", async () => {
  const res = await GET(jsonRequest("GET", "/api/auth/oauth/facebook"), { params: Promise.resolve({ provider: "facebook" }) });
  expect(res.status).toBe(404);
});

// Regresses OAUTH_REDIRECT_BASE being used for two different origins: the
// provider's redirect_uri (this backend's own origin, used above by the
// authorize redirect) vs. the post-login redirect (the frontend's origin).
// .env.test deliberately sets these to two different values so a route
// that wrongly used OAUTH_REDIRECT_BASE here would fail this assertion.
test("the callback's post-login redirect uses FRONTEND_BASE_URL, not OAUTH_REDIRECT_BASE", async () => {
  expect(process.env.FRONTEND_BASE_URL).not.toBe(process.env.OAUTH_REDIRECT_BASE);

  // Start the flow for real so the state JWT and its double-submit cookie
  // are both genuinely valid for the callback to accept.
  const startRes = await GET(jsonRequest("GET", "/api/auth/oauth/google"), { params: Promise.resolve({ provider: "google" }) });
  const location = new URL(startRes.headers.get("location")!);
  const state = location.searchParams.get("state")!;
  const cookiePair = startRes.headers.get("set-cookie")!.split(";")[0]!; // "oauth_state=<value>"

  // Stub the two outbound calls the callback makes to Google (token
  // exchange, then userinfo) - this route is otherwise only verified
  // manually against a real OAuth app (see its own top comment), but the
  // post-login redirect target is pure routing logic worth covering here.
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input: any) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "test-access-token" }), { status: 200 });
    }
    if (url.includes("googleapis.com/oauth2/v3/userinfo")) {
      return new Response(
        JSON.stringify({ sub: "google-sub-1", email: "oauth-user@test.com", email_verified: true }),
        { status: 200 },
      );
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  });

  const callbackReq = new Request(
    `http://localhost/api/auth/oauth/google/callback?code=test-code&state=${encodeURIComponent(state)}`,
    { headers: { cookie: cookiePair } },
  );
  const res = await CALLBACK_GET(callbackReq, { params: Promise.resolve({ provider: "google" }) });

  expect(res.status).toBe(302);
  const redirectLocation = res.headers.get("location")!;
  expect(redirectLocation.startsWith(process.env.FRONTEND_BASE_URL!)).toBe(true);
  expect(redirectLocation.startsWith(process.env.OAUTH_REDIRECT_BASE!)).toBe(false);
});
