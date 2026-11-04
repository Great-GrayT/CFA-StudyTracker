import { beforeEach, test, expect } from "vitest";
import { resetDb } from "../helpers/test-db";
import { jsonRequest, readJson } from "../helpers/request";
import { POST } from "../../src/app/api/auth/register/route";
import { POST as LOGIN } from "../../src/app/api/auth/login/route";
import { GET as ME } from "../../src/app/api/auth/me/route";

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
  const bad = await LOGIN(jsonRequest("POST", "/api/auth/login", { email: "a@b.com", password: "wrong" }));
  expect(bad.status).toBe(401);
});

test("me returns 401 with no token and 200 with a valid one", async () => {
  const reg = await readJson(await POST(jsonRequest("POST", "/api/auth/register", { email: "a@b.com", password: "correct-horse-battery" })));
  const unauthed = await ME(jsonRequest("GET", "/api/auth/me"));
  expect(unauthed.status).toBe(401);
  const authed = await ME(jsonRequest("GET", "/api/auth/me", undefined, { Authorization: `Bearer ${reg.token}` }));
  expect(authed.status).toBe(200);
});
