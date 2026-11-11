import { beforeEach, afterEach, test, expect, vi } from "vitest";
import { resetDb } from "../helpers/test-db";
import { readJson } from "../helpers/request";
import { registerUser, authedRequest } from "../helpers/fixtures";

beforeEach(async () => {
  await resetDb();
});

afterEach(() => {
  vi.restoreAllMocks();
});

test("the lookup requires a signed-in user", async () => {
  // It exposes no user data, but it is a proxy to a third-party service and an
  // open proxy is somebody else's rate limit to burn.
  const { GET } = await import("../../src/app/api/geocode/route");
  const res = await GET(new Request("http://test/api/geocode?q=London"));
  expect(res.status).toBe(401);
});

test.each(["", "L", "  "])(
  "a query of %j returns an empty list without calling the provider",
  async (query) => {
    // An empty box is the normal state of a search field, and one letter would
    // return noise. Neither is worth a network call.
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { GET } = await import("../../src/app/api/geocode/route");
    const user = await registerUser();
    const res = await GET(
      authedRequest(user, `/api/geocode?q=${encodeURIComponent(query)}`, undefined, "GET"),
    );
    expect(res.status).toBe(200);
    expect(await readJson(res)).toEqual({ results: [] });
    expect(fetchSpy).not.toHaveBeenCalled();
  },
);

test("matches are returned with coordinates and a zone for each", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(
      JSON.stringify({
        results: [
          {
            name: "Manchester",
            country_code: "GB",
            latitude: 53.48,
            longitude: -2.24,
            timezone: "Europe/London",
            admin1: "England",
          },
          {
            name: "Manchester",
            country_code: "US",
            latitude: 42.99,
            longitude: -71.46,
            timezone: "America/New_York",
            admin1: "New Hampshire",
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  );

  const { GET } = await import("../../src/app/api/geocode/route");
  const user = await registerUser();
  const res = await GET(authedRequest(user, "/api/geocode?q=Manchester", undefined, "GET"));
  expect(res.status).toBe(200);

  const body = (await readJson(res)) as {
    results: { countryCode: string; timeZone: string }[];
  };
  // Both Manchesters, so the candidate picks. Returning only the first would
  // put someone in New Hampshire on London email times with nothing able to
  // detect it.
  expect(body.results).toHaveLength(2);
  expect(body.results.map((r) => r.countryCode)).toEqual(["GB", "US"]);
  expect(body.results.map((r) => r.timeZone)).toEqual(["Europe/London", "America/New_York"]);
});

test("an unreachable provider is an empty list, not a 500", async () => {
  // Nothing in the app requires a location, so a dead forecast service must
  // degrade to "we could not find that place" rather than an error page.
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));

  const { GET } = await import("../../src/app/api/geocode/route");
  const user = await registerUser();
  const res = await GET(authedRequest(user, "/api/geocode?q=London", undefined, "GET"));
  expect(res.status).toBe(200);
  expect(await readJson(res)).toEqual({ results: [] });
});

test("a provider error status is an empty list, not a 500", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("rate limited", { status: 429 }));

  const { GET } = await import("../../src/app/api/geocode/route");
  const user = await registerUser();
  const res = await GET(authedRequest(user, "/api/geocode?q=London", undefined, "GET"));
  expect(res.status).toBe(200);
  expect(await readJson(res)).toEqual({ results: [] });
});

test("a garbled provider body is an empty list, not a 500", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response("<html>not json</html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    }),
  );

  const { GET } = await import("../../src/app/api/geocode/route");
  const user = await registerUser();
  const res = await GET(authedRequest(user, "/api/geocode?q=London", undefined, "GET"));
  expect(res.status).toBe(200);
  expect(await readJson(res)).toEqual({ results: [] });
});
