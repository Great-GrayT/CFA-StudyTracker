import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { APP_ROUTES, LEGACY_REDIRECTS, needsLogin } from "./routes";

test("app routes need a session, auth routes never do", () => {
  expect(needsLogin("/today", false)).toBe(true);
  expect(needsLogin("/syllabus/abc", false)).toBe(true);
  expect(needsLogin("/today", true)).toBe(false);
  expect(needsLogin("/login", false)).toBe(false);
  expect(needsLogin("/reset-password", false)).toBe(false);
});

test("a route prefix does not guard a longer sibling path", () => {
  expect(needsLogin("/todayish", false)).toBe(false);
});

test("every legacy route has a new home", () => {
  const map = Object.fromEntries(LEGACY_REDIRECTS.map((r) => [r.source, r.destination]));
  expect(map["/coverage"]).toBe("/syllabus");
  expect(map["/coverage/explore"]).toBe("/syllabus?view=3d");
  expect(map["/coverage/:topicId"]).toBe("/syllabus/:topicId");
  expect(map["/los/:losId"]).toBe("/syllabus?los=:losId");
  expect(map["/pace"]).toBe("/progress?tab=pace");
  expect(map["/mocks"]).toBe("/progress?tab=mocks");
  expect(map["/logs"]).toBe("/progress?tab=journal");
  expect(map["/watchdogs"]).toBe("/settings#system");
});

test("the explore redirect precedes the :topicId param route", () => {
  const src = LEGACY_REDIRECTS.map((r) => r.source);
  expect(src.indexOf("/coverage/explore")).toBeLessThan(src.indexOf("/coverage/:topicId"));
});

// Next needs a literal matcher, so middleware.ts cannot build it from
// APP_ROUTES. Read the file as text to keep the two from drifting.
test("the middleware matcher literals match APP_ROUTES", () => {
  const src = readFileSync(join(__dirname, "..", "middleware.ts"), "utf8");
  const block = /matcher:\s*\[([^\]]*)\]/.exec(src)?.[1] ?? "";
  const literals = [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  expect(literals).toEqual(APP_ROUTES.map((r) => `${r}/:path*`));
});
