import { timingSafeEqual } from "node:crypto";
import { linkOrCreateOauthUser, signJwt, verifyJwt } from "../../../../../../lib/FUNC-auth";
import { getProviderConfig, redirectUriFor, requiredEnv } from "../providers";
import { extractVerifiedGithubEmail, extractVerifiedGoogleEmail, type GithubEmail, type GoogleProfile } from "./profile";

// Not independently unit-tested: every branch past state verification is a
// real HTTP call to the provider's token/profile endpoints, which only a
// real Google/GitHub OAuth app (configured at deploy, Task 17) can answer.
// Verified manually against a real app during deploy instead. The pure
// email-verification logic (profile.ts) and linkOrCreateOauthUser
// (FUNC-auth.ts) ARE unit tested, since those don't require real network
// calls.

type RouteContext = { params: { provider: string } | Promise<{ provider: string }> };

interface TokenResponse {
  access_token: string;
}

interface GithubUser {
  id: number;
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) {
    return null;
  }
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      return part.slice(idx + 1).trim();
    }
  }
  return null;
}

// Constant-time compare, same pattern verifyJwt uses for its own
// signature check - a mismatched-length early return before timingSafeEqual
// is fine (throwing on unequal length isn't a usable side channel here).
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

async function fetchGoogleEmail(accessToken: string): Promise<{ providerAccountId: string; email: string } | null> {
  const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error("Failed to fetch Google profile");
  }
  const profile = (await res.json()) as GoogleProfile;
  const email = extractVerifiedGoogleEmail(profile);
  if (!email) {
    return null;
  }
  return { providerAccountId: profile.sub, email };
}

async function fetchGithubEmail(accessToken: string): Promise<{ providerAccountId: string; email: string } | null> {
  const headers = { Authorization: `Bearer ${accessToken}`, "User-Agent": "cfa-study-tracker" };
  const userRes = await fetch("https://api.github.com/user", { headers });
  if (!userRes.ok) {
    throw new Error("Failed to fetch GitHub profile");
  }
  const profile = (await userRes.json()) as GithubUser;

  // Always consult /user/emails (needs the user:email scope requested in
  // the redirect step) rather than trusting the public profile's `email`
  // field - that field carries no verification signal on its own.
  const emailsRes = await fetch("https://api.github.com/user/emails", { headers });
  if (!emailsRes.ok) {
    throw new Error("Failed to fetch GitHub emails");
  }
  const emails = (await emailsRes.json()) as GithubEmail[];
  const email = extractVerifiedGithubEmail(emails);
  if (!email) {
    return null;
  }
  return { providerAccountId: String(profile.id), email };
}

export async function GET(req: Request, context: RouteContext): Promise<Response> {
  const { provider } = await context.params;
  const config = getProviderConfig(provider);
  if (!config) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) {
    return Response.json({ error: "Missing code or state" }, { status: 400 });
  }

  // Double-submit check: the redirect route set an httpOnly cookie carrying
  // this same state value. Requiring the query param to match the cookie
  // (constant-time) binds the callback to the browser that started the
  // flow, closing a login-CSRF where an attacker completes their own OAuth
  // flow and hands a victim's browser the resulting code+state - without
  // the cookie, the victim's browser would otherwise still present a
  // signature- and expiry-valid state it never actually received.
  const cookieState = readCookie(req, "oauth_state");
  if (!cookieState || !safeEqual(cookieState, state)) {
    return Response.json({ error: "State mismatch" }, { status: 400 });
  }

  // Verify state itself before touching the provider at all: it must be a
  // token this server signed (not forged), not expired, and minted for
  // this same provider - the provider-prefix check stops a state issued
  // for one provider being replayed against another provider's callback.
  const statePayload = verifyJwt(state);
  if (!statePayload || !statePayload.userId.startsWith(`${provider}:`)) {
    return Response.json({ error: "Invalid or expired state" }, { status: 400 });
  }

  const tokenRes = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: redirectUriFor(provider),
      grant_type: "authorization_code",
    }),
  });
  if (!tokenRes.ok) {
    return Response.json({ error: "Token exchange failed" }, { status: 502 });
  }
  const { access_token: accessToken } = (await tokenRes.json()) as TokenResponse;

  const profile = provider === "google" ? await fetchGoogleEmail(accessToken) : await fetchGithubEmail(accessToken);
  if (!profile) {
    // Fail closed: linkOrCreateOauthUser trusts this email to find-or-create
    // a User, so an unverified email must never reach it - that's how an
    // attacker could otherwise claim someone else's existing account.
    return Response.json({ error: "Email not verified with provider" }, { status: 403 });
  }

  const user = await linkOrCreateOauthUser(provider, profile.providerAccountId, profile.email);
  const token = signJwt({ userId: user.id, tokenVersion: user.tokenVersion });

  const base = requiredEnv("OAUTH_REDIRECT_BASE");
  const headers = new Headers({ Location: `${base}/auth/callback?token=${encodeURIComponent(token)}` });
  // Clear the one-time state cookie now that it's been consumed.
  headers.append("Set-Cookie", `oauth_state=; Path=/api/auth/oauth/${provider}; HttpOnly; SameSite=Lax; Max-Age=0`);
  return new Response(null, { status: 302, headers });
}
