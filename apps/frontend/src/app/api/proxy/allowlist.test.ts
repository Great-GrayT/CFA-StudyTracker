import { test, expect } from "vitest";
import { allowed } from "./allowlist";

// The proxy allowlist, tested because of how it fails: an unlisted path returns
// 404 even though the backend route exists, is authenticated, and is covered by
// its own tests. The feature simply does not work in the browser, and nothing
// anywhere says why.
//
// That is not hypothetical. The study-location city picker shipped against
// `geocode`, which was not listed, so the backend endpoint, its validation and
// its eight tests were all correct and the picker was dead on arrival.

// Every path the client actually requests. Grepping `api.get`, `api.post`,
// `api.patch` and `api.del` across src/ should turn up nothing beyond this set.
test.each([
  "plans",
  "plans/abc123",
  "plans/abc123/holidays",
  "plans/abc123/packages",
  "plans/import",
  "packages",
  "logs",
  "logs/abc123",
  "mock-exams",
  "mock-exams/abc123",
  "progress",
  "curriculum/levels",
  "export/all",
  "export/log",
  "push/subscribe",
  "push/subscriptions",
  "cron/runs",
  "auth/me",
  "auth/password",
  "auth/passkeys",
  // The two the settings screen needs.
  "settings",
  "geocode",
])("the client path %s is reachable", (path) => {
  expect(allowed(path)).toBe(true);
});

// The allowlist exists to keep these out. Each is reachable on the backend and
// none should be callable from a browser session.
test.each([
  // Protected by a shared secret rather than a user JWT, so proxying it would
  // hand a browser session the keys to the nightly batch.
  "cron/tick",
  // Returns a token in the body, which must be captured into the httpOnly
  // cookie by /api/session rather than passed through to client JavaScript.
  "auth/login",
  "auth/register",
  "auth/oauth/google",
  "auth/oauth/google/callback",
  // Unauthenticated operator diagnostics. Already public on the backend, but
  // there is no reason for the app's own origin to serve it.
  "health",
  // Not a route at all; guards against a regex that matches too much.
  "",
  "..",
  "../../etc/passwd",
])("the non-client path %j is not reachable", (path) => {
  expect(allowed(path)).toBe(false);
});

test("a prefix rule does not match a longer unrelated path", () => {
  // `^settings$` and `^geocode$` are anchored both ends on purpose: a rule
  // written as `^settings` would also admit anything the backend later mounts
  // beneath it.
  expect(allowed("settings/secret")).toBe(false);
  expect(allowed("geocode/internal")).toBe(false);
  expect(allowed("progress/raw")).toBe(false);
});

test("a rule anchored with a separator admits children but not siblings", () => {
  // `^plans(\/|$)` is deliberately broader, since the plan subtree is the app's
  // main surface. It must not admit a sibling that merely starts the same way.
  expect(allowed("plans")).toBe(true);
  expect(allowed("plans/abc/packages/def")).toBe(true);
  expect(allowed("plansecret")).toBe(false);
});
