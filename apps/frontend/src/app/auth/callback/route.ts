import { NextRequest } from "next/server";
import { setToken } from "@/lib/session";

// The backend's OAuth callback redirects here with ?token=... in the query
// string.
//
// This is a route handler, not a page, which is the whole trick: the token is
// read and stored server side and the browser is redirected immediately, so the
// token never enters client JavaScript, never lands in the history entry the
// user can navigate back to, and never reaches a client component that might
// log it. Revision 1 of the design had a client page calling replaceState,
// which only papers over the history entry and still exposes the value.
export async function GET(req: NextRequest): Promise<Response> {
  const token = req.nextUrl.searchParams.get("token");
  const origin = req.nextUrl.origin;

  if (!token) {
    const reason = req.nextUrl.searchParams.get("error") ?? "missing_token";
    return Response.redirect(`${origin}/login?oauth=${encodeURIComponent(reason)}`, 303);
  }

  await setToken(token);

  // Land on the root and let it decide: it reads the active plan and sends the
  // user to onboarding or to Today. Deciding here would mean a second backend
  // round trip inside a redirect.
  return Response.redirect(`${origin}/`, 303);
}
