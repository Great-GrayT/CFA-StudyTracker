import { randomBytes } from "node:crypto";
import { signJwt } from "../../../../../lib/FUNC-auth";
import { getProviderConfig, redirectUriFor } from "./providers";

// Next 15 passes params as a Promise at runtime; tests here call the
// handler directly with a plain object. Awaiting either works the same -
// a non-Promise value resolves to itself - so one signature covers both.
type RouteContext = { params: { provider: string } | Promise<{ provider: string }> };

export async function GET(_req: Request, context: RouteContext): Promise<Response> {
  const { provider } = await context.params;
  const config = getProviderConfig(provider);
  if (!config) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  // State is a signed, short-TTL JWT - reusing the app's own HMAC secret via
  // signJwt rather than standing up a second one. It carries a random nonce
  // (so it isn't a predictable value) plus the provider name, and expires
  // in 5 minutes. The callback route verifies the signature, expiry, and
  // that the embedded provider matches the URL before it ever calls the
  // provider's token endpoint, so a forged, stale, or cross-provider state
  // can't ride through.
  const nonce = randomBytes(16).toString("hex");
  const state = signJwt({ userId: `${provider}:${nonce}`, tokenVersion: 0 }, { ttlSeconds: 300 });

  const query = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUriFor(provider),
    response_type: "code",
    scope: config.scope,
    state,
  });

  // Double-submit cookie: the callback route requires the `state` query
  // param it receives to match this cookie before it trusts the state at
  // all. That binds the flow to the browser that started it, which a
  // signed-but-unbound state param alone does not - without this, an
  // attacker could complete their own OAuth flow and hand the resulting
  // (validly signed) code+state to a victim's browser to log them into the
  // attacker's account (login CSRF / session fixation).
  const headers = new Headers({ Location: `${config.authUrl}?${query.toString()}` });
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  headers.append(
    "Set-Cookie",
    `oauth_state=${state}; Path=/api/auth/oauth/${provider}; HttpOnly; SameSite=Lax; Max-Age=300${secure}`,
  );

  return new Response(null, { status: 302, headers });
}
