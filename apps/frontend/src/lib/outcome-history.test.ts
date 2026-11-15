import { test, expect } from "vitest";
import { arrivalAction, closeAction, flagsAfter, openAction } from "./outcome-history";

const base = { pathname: "/syllabus", los: null, navType: "navigate", mark: undefined, firstArrival: true } as const;

test("no sheet open: nothing to fix, and nothing to step back over", () => {
  expect(arrivalAction({ ...base, prev: null })).toBe("clear");
  expect(arrivalAction({ ...base, prev: { pathname: "/syllabus", los: "a" } })).toBe("clear");
});

test("opened on the same page: the sheetless entry is already underneath", () => {
  expect(arrivalAction({ ...base, los: "a", prev: { pathname: "/syllabus", los: null } })).toBe("backable");
});

test("switching outcome inside an open sheet keeps the current state", () => {
  expect(arrivalAction({ ...base, los: "b", prev: { pathname: "/syllabus", los: "a" } })).toBe("keep");
});

test("arriving with the sheet open inserts the sheetless page underneath", () => {
  expect(arrivalAction({ ...base, los: "a", prev: null })).toBe("insert");
  expect(arrivalAction({ ...base, los: "a", prev: { pathname: "/today", los: null } })).toBe("insert");
});

test("a reload or a Back/Forward onto an entry we pushed does not insert again", () => {
  expect(arrivalAction({ ...base, los: "a", prev: null, mark: "a" })).toBe("backable");
  expect(arrivalAction({ ...base, los: "a", prev: null, navType: "reload" })).toBe("backable");
  expect(arrivalAction({ ...base, los: "a", prev: null, navType: "back_forward" })).toBe("backable");
});

test("opening pushes from a closed sheet, replaces from an open one, ignores the same id", () => {
  expect(openAction(null, "a")).toBe("push");
  expect(openAction("a", "b")).toBe("replace");
  expect(openAction("a", "a")).toBe("none");
});

test("closing steps back when it can, never twice, else strips the param", () => {
  expect(closeAction({ backable: true, closing: false })).toBe("back");
  expect(closeAction({ backable: false, closing: true })).toBe("none");
  expect(closeAction({ backable: false, closing: false })).toBe("replace");
});

test("the load's navigation type counts only on the document's first arrival", () => {
  // A later remount (prev lost) in a reloaded document must not assume a
  // sheetless entry is underneath, or close would step Back off the page.
  expect(arrivalAction({ ...base, los: "a", prev: null, navType: "reload", firstArrival: false })).toBe("insert");
  expect(arrivalAction({ ...base, los: "a", prev: null, navType: "back_forward", firstArrival: false })).toBe("insert");
});

test("every arrival ends a pending close, so a sheet reached by Back can still close", () => {
  expect(flagsAfter("backable", { backable: false, closing: true })).toEqual({ backable: true, closing: false });
  expect(flagsAfter("insert", { backable: false, closing: true })).toEqual({ backable: true, closing: false });
  expect(flagsAfter("clear", { backable: true, closing: true })).toEqual({ backable: false, closing: false });
  expect(flagsAfter("keep", { backable: true, closing: true })).toEqual({ backable: true, closing: false });
  expect(flagsAfter("keep", { backable: false, closing: false })).toEqual({ backable: false, closing: false });
});
