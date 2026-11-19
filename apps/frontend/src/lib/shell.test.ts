// @vitest-environment jsdom
import { test, expect } from "vitest";
import { isTypingTarget, planGuardTarget, commandItems } from "./shell";
import type { Curriculum } from "./types";

const fixtureCurriculum: Curriculum = {
  levelId: "II",
  curriculumVersion: "2027",
  topics: [
    {
      id: "t-quant",
      name: "Quantitative methods",
      order: 1,
      examWeightMin: 5,
      examWeightMax: 10,
      readings: [
        {
          id: "r-1",
          name: "Basics of multiple regression",
          order: 1,
          los: [
            { id: "los-1", text: "Describe the types of investment problems.", order: 1 },
            { id: "los-2", text: "Formulate a multiple regression model.", order: 2 },
          ],
        },
        {
          id: "r-2",
          name: "Evaluating regression model fit",
          order: 2,
          los: [{ id: "los-3", text: "Evaluate how well a model fits the data.", order: 1 }],
        },
      ],
    },
    {
      id: "t-eco",
      name: "Economics",
      order: 2,
      examWeightMin: 5,
      examWeightMax: 10,
      readings: [
        {
          id: "r-3",
          name: "Currency exchange rates",
          order: 1,
          los: [
            { id: "los-4", text: "Calculate a forward premium.", order: 1 },
            { id: "los-5", text: "Explain covered interest parity.", order: 2 },
          ],
        },
      ],
    },
  ],
};
const fixtureLosCount = 5;

test("R does not fire while typing", () => {
  const input = document.createElement("input");
  const area = document.createElement("textarea");
  const div = document.createElement("div");
  div.contentEditable = "true";
  const combo = document.createElement("button");
  combo.setAttribute("role", "combobox");
  for (const el of [input, area, div, combo]) expect(isTypingTarget(el)).toBe(true);
  expect(isTypingTarget(document.createElement("button"))).toBe(false);
  expect(isTypingTarget(null)).toBe(false);
});

test("no plan sends app pages to onboarding, never loops", () => {
  expect(planGuardTarget(404, "/today")).toBe("/onboarding");
  expect(planGuardTarget(404, "/settings")).toBeNull(); // account and security still reachable
  expect(planGuardTarget(404, "/onboarding")).toBeNull();
  expect(planGuardTarget(401, "/plan")).toBe("/login");
  expect(planGuardTarget("ok", "/today")).toBeNull();
  expect(planGuardTarget("error", "/today")).toBeNull(); // offline must not bounce
});

test("palette lists every outcome and the six pages", () => {
  const items = commandItems(fixtureCurriculum);
  expect(items.filter((i) => i.group === "Pages").map((i) => i.href)).toEqual([
    "/today",
    "/syllabus",
    "/progress",
    "/packages",
    "/plan",
    "/settings",
  ]);
  expect(items.filter((i) => i.group === "Outcomes")).toHaveLength(fixtureLosCount);
  expect(items.find((i) => i.group === "Outcomes")!.href).toMatch(/^\/syllabus\?los=/);
});

test("breadcrumb names ids and the tab, last crumb is the page", async () => {
  const { breadcrumbTrail } = await import("./shell");
  expect(breadcrumbTrail("/today", null)).toEqual([{ label: "Today" }]);
  expect(breadcrumbTrail("/syllabus/t-eco", null, { "t-eco": "Economics" })).toEqual([
    { label: "Syllabus", href: "/syllabus" },
    { label: "Economics" },
  ]);
  expect(breadcrumbTrail("/plan", "setup")).toEqual([{ label: "Plan", href: "/plan" }, { label: "Setup" }]);
});

test("plan status reads the error before cached data", async () => {
  const { planStatus } = await import("./shell");
  const cached = { id: "p1" };
  expect(planStatus({ data: undefined, error: null })).toBeNull(); // still loading
  expect(planStatus({ data: cached, error: null })).toBe("ok");
  // A refetch that fails keeps the cached plan; the 404 or 401 must still win.
  expect(planStatus({ data: cached, error: { status: 404 } })).toBe(404);
  expect(planStatus({ data: cached, error: { status: 401 } })).toBe(401);
  // Offline with a cached plan stays put.
  expect(planStatus({ data: cached, error: { status: 0 } })).toBe("ok");
  expect(planStatus({ data: undefined, error: new Error("boom") })).toBe("error");
});
