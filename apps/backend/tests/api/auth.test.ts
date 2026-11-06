import { beforeEach, test, expect } from "vitest";
import { resetDb } from "../helpers/test-db";
import { jsonRequest, readJson } from "../helpers/request";
import { POST } from "../../src/app/api/auth/register/route";
import { POST as LOGIN } from "../../src/app/api/auth/login/route";
import { GET as ME } from "../../src/app/api/auth/me/route";
import { POST as CHANGE_PASSWORD } from "../../src/app/api/auth/password/route";

beforeEach(resetDb);

test("register creates a user and returns a token", async () => {
  const res = await POST(jsonRequest("POST", "/api/auth/register", { email: "a@b.com", password: "correct-horse-battery" }));
  expect(res.status).toBe(201);
  const body = await readJson(res);
  expect(body.token).toBeTypeOf("string");
});

test("register rejects a duplicate email with 409", async () => {
  await POST(jsonRequest("POST", "/api/auth/register", { email: "a@b.com", password: "correct-horse-battery" }));
  const res = await POST(jsonRequest("POST", "/api/auth/register", { email: "a@b.com", password: "another-password" }));
  expect(res.status).toBe(409);
});

test("login succeeds with the right password and fails with the wrong one", async () => {
  await POST(jsonRequest("POST", "/api/auth/register", { email: "a@b.com", password: "correct-horse-battery" }));
  const ok = await LOGIN(jsonRequest("POST", "/api/auth/login", { email: "a@b.com", password: "correct-horse-battery" }));
  expect(ok.status).toBe(200);
  // Must be >= 8 chars (loginSchema's own min(8)) so this actually reaches
  // login/route.ts's real verifyPassword comparison-and-reject branch,
  // rather than getting rejected by zod validation before that code ever
  // runs - a too-short "wrong" password would 401 for the wrong reason and
  // leave the real wrong-password path completely untested.
  const bad = await LOGIN(
    jsonRequest("POST", "/api/auth/login", { email: "a@b.com", password: "definitely-not-the-right-password" }),
  );
  expect(bad.status).toBe(401);
});

test("me returns 401 with no token and 200 with a valid one", async () => {
  const reg = await readJson(await POST(jsonRequest("POST", "/api/auth/register", { email: "a@b.com", password: "correct-horse-battery" })));
  const unauthed = await ME(jsonRequest("GET", "/api/auth/me"));
  expect(unauthed.status).toBe(401);
  const authed = await ME(jsonRequest("GET", "/api/auth/me", undefined, { Authorization: `Bearer ${reg.token}` }));
  expect(authed.status).toBe(200);
});

test("changing the password rejects the wrong current password, and never bumps tokenVersion for it", async () => {
  const reg = await readJson(
    await POST(jsonRequest("POST", "/api/auth/register", { email: "a@b.com", password: "correct-horse-battery" })),
  );
  const res = await CHANGE_PASSWORD(
    jsonRequest(
      "POST",
      "/api/auth/password",
      { currentPassword: "totally-wrong-password", newPassword: "a-brand-new-password" },
      { Authorization: `Bearer ${reg.token}` },
    ),
  );
  expect(res.status).toBe(400);
  // The OLD token must still work - a rejected attempt must not revoke anything.
  const stillAuthed = await ME(jsonRequest("GET", "/api/auth/me", undefined, { Authorization: `Bearer ${reg.token}` }));
  expect(stillAuthed.status).toBe(200);
});

// Proves revocation actually works end-to-end: this is the only route in
// the codebase that bumps tokenVersion, and requireUser (checked by every
// protected route, exercised here via GET /api/auth/me) is what makes that
// bump actually matter - a token signed before the change must stop
// working, not just the DB row changing underneath it.
test("changing the password revokes every JWT issued before the change", async () => {
  const reg = await readJson(
    await POST(jsonRequest("POST", "/api/auth/register", { email: "a@b.com", password: "correct-horse-battery" })),
  );
  const oldToken = reg.token as string;

  const changeRes = await CHANGE_PASSWORD(
    jsonRequest(
      "POST",
      "/api/auth/password",
      { currentPassword: "correct-horse-battery", newPassword: "a-brand-new-password" },
      { Authorization: `Bearer ${oldToken}` },
    ),
  );
  expect(changeRes.status).toBe(200);

  const withOldToken = await ME(jsonRequest("GET", "/api/auth/me", undefined, { Authorization: `Bearer ${oldToken}` }));
  expect(withOldToken.status).toBe(401);

  // The new password actually works via a fresh login (new token, new tokenVersion).
  const newLogin = await LOGIN(
    jsonRequest("POST", "/api/auth/login", { email: "a@b.com", password: "a-brand-new-password" }),
  );
  expect(newLogin.status).toBe(200);
  const newToken = (await readJson(newLogin)).token as string;
  const withNewToken = await ME(jsonRequest("GET", "/api/auth/me", undefined, { Authorization: `Bearer ${newToken}` }));
  expect(withNewToken.status).toBe(200);
});
