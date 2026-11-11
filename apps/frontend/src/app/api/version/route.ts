// What build this origin is currently serving.
//
// An installed PWA can stay open for days without a navigation, and a service
// worker only looks for a replacement when the page registers it, which
// happens on load. `registration.update()` does not help either: it re-fetches
// the URL the worker was registered with, `/sw.js?v=<old build>`, and
// public/sw.js is byte-identical in every release, so it never finds anything
// new. Without this endpoint the only way to learn that a release happened is
// to reload, which is the thing the person is being asked to do.
//
// One field, no auth, no user data: it says nothing a visitor could not learn
// by viewing source.
import { NextResponse } from "next/server";

// Inlined at build time, so this reports the build of whichever deployment
// answers the request, which is exactly the comparison the client needs.
const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID ?? "dev";

// Never prerendered and never cached: a cached answer would report the build
// that was current when it was cached, which is the one case this exists to
// detect.
export const dynamic = "force-dynamic";

export function GET(): NextResponse {
  return NextResponse.json(
    { buildId: BUILD_ID },
    { headers: { "cache-control": "no-store, max-age=0" } },
  );
}
