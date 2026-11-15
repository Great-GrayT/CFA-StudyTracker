import { test, expect } from "vitest";
import { cn } from "./utils";
test("cn merges conflicting tailwind classes, last wins", () => {
  expect(cn("px-2 text-sm", false && "hidden", "px-4")).toBe("text-sm px-4");
});
