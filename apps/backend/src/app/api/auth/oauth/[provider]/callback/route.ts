import { linkOrCreateOauthUser, signJwt, verifyJwt } from "../../../../../../lib/FUNC-auth";
import { getProviderConfig, redirectUriFor } from "../providers";

// Not independently unit-tested: every branch past state verification is a
// real HTTP call to the provider's token/profile endpoints, which only a
// real Google/GitHub OAuth app (configured at deploy, Task 17) can answer.
// Verified manually against a real app during deploy instead.

type RouteContext = { params: { provider: string } | Promise<{ provider: string }> };

interface TokenResponse {
  access_token: string;
}

interface GoogleProfile {
  sub: string;
  email: string;
}

interface GithubProfile {
  id: number;
  email: string | null;
}

interface GithubEmail {
  email: string;
  primary: boolean;
  verified: boolean;
}

async function fetchGoogleProfile(accessToken: string): Promise<{ providerAccountId: string; email: string }> {
  const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error("Failed to fetch Google profile");
  }
  const profile = (await res.json()) as GoogleProfile;
  return { providerAccountId: profile.sub, email: profile.email };
}

async function fetchGithubProfile(accessToken: string): Promise<{ providerAccountId: string; email: string }> {
  const headers = { Authorization: `Bearer ${accessToken}`, "User-Agent": "cfa-study-tracker" };
  const userRes = await fetch("https://api.github.com/user", { headers });
  if (!userRes.ok) {
    throw new Error("Failed to fetch GitHub profile");
  }
  const profile = (await userRes.json()) as GithubProfile;

  let email = profile.email;
  if (!email) {
    // GitHub omits `email` on the profile when the user keeps it private;
    // the verified primary address only comes back from this separate,
    // more-privileged endpoint (needs the user:email scope requested above).
    const emailsRes = await fetch("https://api.github.com/user/emails", { headers });
    if (emailsRes.ok) {
      const emails = (await emailsRes.json()) as GithubEmail[];
      email = emails.find((e) => e.primary && e.verified)?.email ?? emails[0]?.email ?? null;
    }
  }
  if (!email) {
    throw new Error("GitHub account has no accessible email");
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

  // Verify state before touching the provider at all: it must be a token
  // this server signed (not forged), not expired, and minted for this same
  // provider - the provider-prefix check stops a state issued for one
  // provider being replayed against another provider's callback.
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

  const { providerAccountId, email } =
    provider === "google" ? await fetchGoogleProfile(accessToken) : await fetchGithubProfile(accessToken);

  const user = await linkOrCreateOauthUser(provider, providerAccountId, email);
  const token = signJwt({ userId: user.id, tokenVersion: user.tokenVersion });

  const base = process.env.OAUTH_REDIRECT_BASE ?? "";
  return Response.redirect(`${base}/auth/callback?token=${encodeURIComponent(token)}`, 302);
}
