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

  return Response.redirect(`${config.authUrl}?${query.toString()}`, 302);
}
