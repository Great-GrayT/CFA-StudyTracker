import { NextRequest } from "next/server";
import { backendBase } from "@/lib/session";

// Kicks off an OAuth sign in.
//
// This is a redirect rather than a link straight to the backend for one
// reason: BACKEND_BASE_URL is server-only, so the browser never learns the
// API's origin. Keeping it that way means the CSP can stay at
// `connect-src 'self'` with no exceptions.
//
// A top-level navigation, not a fetch, so CORS never enters into it. The
// backend sends the user to the provider, the provider sends them back to the
// backend's callback, and that redirects to /auth/callback here with the token.

const PROVIDERS = new Set(["google", "github"]);

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ provider: string }> },
): Promise<Response> {
  const { provider } = await ctx.params;
  if (!PROVIDERS.has(provider)) {
    return Response.redirect(`${req.nextUrl.origin}/login?oauth=unknown_provider`, 303);
  }
  return Response.redirect(`${backendBase()}/api/auth/oauth/${provider}`, 303);
}
