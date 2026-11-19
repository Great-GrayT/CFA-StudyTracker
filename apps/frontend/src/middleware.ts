import { NextResponse, type NextRequest } from "next/server";
import { needsLogin } from "./lib/routes";
import { SESSION_COOKIE } from "./lib/session-cookie";

// Presence check only: the backend still validates the token. This just stops
// a signed-out visitor seeing an app shell that cannot load any data.
export function middleware(request: NextRequest) {
  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);
  if (needsLogin(request.nextUrl.pathname, hasSession)) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

// Literals, because Next statically analyses this. routes.test.ts keeps it in
// step with APP_ROUTES.
export const config = {
  matcher: [
    "/today/:path*",
    "/syllabus/:path*",
    "/progress/:path*",
    "/packages/:path*",
    "/plan/:path*",
    "/settings/:path*",
    "/onboarding/:path*",
  ],
};
