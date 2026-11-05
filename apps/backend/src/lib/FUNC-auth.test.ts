import { beforeEach, test, expect } from "vitest";
import { resetDb } from "../../tests/helpers/test-db";
import { db } from "./db";
import { linkOrCreateOauthUser, signJwt, verifyJwt } from "./FUNC-auth";

beforeEach(resetDb);

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

test("linkOrCreateOauthUser creates a new user and links a new OAuthAccount when neither exists", async () => {
  const user = await linkOrCreateOauthUser("google", "google-sub-1", "new@example.com");

  const dbUser = await db.user.findUnique({ where: { email: "new@example.com" } });
  expect(dbUser?.id).toBe(user.id);
  expect(dbUser?.passwordHash).toBeNull();

  const account = await db.oAuthAccount.findUnique({
    where: { provider_providerAccountId: { provider: "google", providerAccountId: "google-sub-1" } },
  });
  expect(account?.userId).toBe(user.id);
});

test("linkOrCreateOauthUser links a new OAuthAccount to an existing user found by email", async () => {
  const existing = await db.user.create({ data: { email: "existing@example.com", passwordHash: "irrelevant" } });

  const result = await linkOrCreateOauthUser("github", "gh-1", "existing@example.com");

  expect(result.id).toBe(existing.id);
  const account = await db.oAuthAccount.findUnique({
    where: { provider_providerAccountId: { provider: "github", providerAccountId: "gh-1" } },
  });
  expect(account?.userId).toBe(existing.id);
});

test("linkOrCreateOauthUser reuses an existing OAuthAccount rather than creating a duplicate user", async () => {
  const first = await linkOrCreateOauthUser("google", "google-sub-2", "repeat@example.com");
  const second = await linkOrCreateOauthUser("google", "google-sub-2", "repeat@example.com");

  expect(second.id).toBe(first.id);
  const users = await db.user.findMany({ where: { email: "repeat@example.com" } });
  expect(users).toHaveLength(1);
});
