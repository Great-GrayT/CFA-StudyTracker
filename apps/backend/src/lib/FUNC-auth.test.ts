import { test, expect } from "vitest";
import { signJwt, verifyJwt } from "./FUNC-auth";

test("verifyJwt returns the payload for a token it signed", () => {
  const token = signJwt({ userId: "u1", tokenVersion: 0 });
  expect(verifyJwt(token)).toEqual({ userId: "u1", tokenVersion: 0 });
});

test("verifyJwt returns null for a tampered token", () => {
  const token = signJwt({ userId: "u1", tokenVersion: 0 });
  expect(verifyJwt(token + "x")).toBeNull();
});

test("verifyJwt returns null for an expired token", () => {
  const token = signJwt({ userId: "u1", tokenVersion: 0 }, { ttlSeconds: -1 });
  expect(verifyJwt(token)).toBeNull();
});
