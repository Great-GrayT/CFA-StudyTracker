import { test, expect } from "vitest";
import { hashPassword, verifyPassword } from "./FUNC-crypto";

test("verifyPassword accepts the correct password", async () => {
  const hash = await hashPassword("correct-horse");
  expect(await verifyPassword("correct-horse", hash)).toBe(true);
});

test("verifyPassword rejects a wrong password", async () => {
  const hash = await hashPassword("correct-horse");
  expect(await verifyPassword("wrong", hash)).toBe(false);
});
