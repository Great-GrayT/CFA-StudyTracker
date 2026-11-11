import { requireUser } from "../../../lib/FUNC-auth";
import { geocodeCity } from "../../../lib/FUNC-weather";

/**
 * City lookup for the profile form.
 *
 * Returns up to five matches with their coordinates and IANA zone, and the
 * candidate picks. It returns a list rather than one best guess because city
 * names are genuinely ambiguous: there is a Manchester in England and one in
 * New Hampshire, and silently choosing the wrong one would put both the
 * candidate's weather copy and, far worse, their email delivery times on the
 * wrong continent, with nothing downstream able to detect it.
 *
 * Authenticated even though it exposes no user data, because it is a proxy to a
 * third-party service and an open proxy is somebody else's rate limit to burn.
 */
export async function GET(req: Request): Promise<Response> {
  const auth = await requireUser(req);
  if (!auth) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const query = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (query.length < 2) {
    // Not an error: an empty box is the normal state of a search field, and a
    // single letter would return noise from the provider.
    return Response.json({ results: [] }, { status: 200 });
  }

  const results = await geocodeCity(query, 5);

  // An unreachable provider and a genuinely unknown place both arrive here as
  // an empty list. The form says "we could not find that place", which is true
  // either way, and nothing in the app requires a location to work.
  return Response.json({ results }, { status: 200 });
}
