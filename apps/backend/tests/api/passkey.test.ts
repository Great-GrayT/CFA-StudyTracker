import { describe, test, expect, beforeEach } from "vitest";
import { db } from "../../src/lib/db";
import { resetDb } from "../helpers/test-db";
import { jsonRequest, readJson } from "../helpers/request";
import { registerUser } from "../helpers/fixtures";
import { POST as REGISTER_OPTIONS } from "../../src/app/api/auth/passkey/register-options/route";
import { POST as LOGIN_OPTIONS } from "../../src/app/api/auth/passkey/login-options/route";
import { POST as LOGIN_VERIFY } from "../../src/app/api/auth/passkey/login-verify/route";
import { GET as LIST } from "../../src/app/api/auth/passkeys/route";
import { DELETE as REMOVE } from "../../src/app/api/auth/passkeys/[id]/route";
import { issueChallenge, consumeChallenge } from "../../src/lib/FUNC-webauthn";

function authed(token: string, url: string, body?: unknown): Request {
  return jsonRequest(body ? "POST" : "GET", url, body, { Authorization: `Bearer ${token}` });
}

/**
 * A stored passkey, inserted directly.
 *
 * The full WebAuthn ceremony needs a real authenticator to sign a challenge,
 * which cannot be faked meaningfully in a unit test. These tests therefore
 * cover what is genuinely ours: challenge handling, ownership scoping, and
 * that a bad response is refused. The signature check itself is
 * simplewebauthn's and is its own library's job to test.
 */
async function storePasskey(userId: string, credentialId = "cred-1") {
  return db.passkey.create({
    data: {
      userId,
      credentialId,
      publicKey: Buffer.from([1, 2, 3, 4]),
      counter: BigInt(5),
      transports: ["internal"],
      label: "Test key",
    },
  });
}

beforeEach(async () => {
  await resetDb();
  process.env.FRONTEND_BASE_URL = "https://study.example.com";
});

describe("challenges", () => {
  test("are single use", async () => {
    const challenge = await issueChallenge("login");
    expect(await consumeChallenge(challenge, "login")).not.toBeNull();
    // A replayed challenge is the exact attack the ceremony exists to stop.
    expect(await consumeChallenge(challenge, "login")).toBeNull();
  });

  test("cannot be redeemed as the wrong kind", async () => {
    const challenge = await issueChallenge("register", "some-user");
    expect(await consumeChallenge(challenge, "login")).toBeNull();
  });

  test("expire", async () => {
    const challenge = await issueChallenge("login");
    await db.webAuthnChallenge.updateMany({
      where: { challenge },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(await consumeChallenge(challenge, "login")).toBeNull();
  });
});

describe("registering a passkey", () => {
  test("requires a session, since a passkey is added to an account", async () => {
    const res = await REGISTER_OPTIONS(jsonRequest("POST", "/api/auth/passkey/register-options"));
    expect(res.status).toBe(401);
  });

  test("returns options and records the challenge against the caller", async () => {
    const user = await registerUser();
    const res = await REGISTER_OPTIONS(
      authed(user.token, "/api/auth/passkey/register-options", {}),
    );
    expect(res.status).toBe(200);
    const options = await readJson(res);
    expect(options.challenge).toBeTypeOf("string");
    expect(options.rp.id).toBe("study.example.com");

    const row = await db.webAuthnChallenge.findUniqueOrThrow({
      where: { challenge: options.challenge as string },
    });
    expect(row.userId).toBe(user.id);
    expect(row.kind).toBe("register");
  });

  test("excludes passkeys the account already has", async () => {
    const user = await registerUser();
    await storePasskey(user.id, "already-registered");
    const options = await readJson(
      await REGISTER_OPTIONS(authed(user.token, "/api/auth/passkey/register-options", {})),
    );
    const ids = (options.excludeCredentials as Array<{ id: string }>).map((c) => c.id);
    expect(ids).toContain("already-registered");
  });
});

describe("signing in with a passkey", () => {
  test("options are available without a session, and name no credentials", async () => {
    const user = await registerUser();
    await storePasskey(user.id);

    const res = await LOGIN_OPTIONS();
    expect(res.status).toBe(200);
    const options = await readJson(res);

    // Listing credentials for an email would turn this unauthenticated route
    // into an account-enumeration oracle, which the password login works hard
    // to avoid being.
    expect(options.allowCredentials ?? []).toEqual([]);
  });

  test("a response for a challenge this server never issued is refused", async () => {
    const user = await registerUser();
    await storePasskey(user.id);

    const clientDataJSON = Buffer.from(
      JSON.stringify({ challenge: "a-challenge-we-never-issued", origin: "https://study.example.com" }),
    ).toString("base64url");

    const res = await LOGIN_VERIFY(
      jsonRequest("POST", "/api/auth/passkey/login-verify", {
        response: { id: "cred-1", response: { clientDataJSON } },
      }),
    );
    expect(res.status).toBe(401);
  });

  test("an unknown credential id is refused", async () => {
    const challenge = await issueChallenge("login");
    const clientDataJSON = Buffer.from(JSON.stringify({ challenge })).toString("base64url");

    const res = await LOGIN_VERIFY(
      jsonRequest("POST", "/api/auth/passkey/login-verify", {
        response: { id: "no-such-credential", response: { clientDataJSON } },
      }),
    );
    expect(res.status).toBe(401);
  });

  test("a malformed body is rejected", async () => {
    const res = await LOGIN_VERIFY(
      jsonRequest("POST", "/api/auth/passkey/login-verify", { response: {} }),
    );
    expect(res.status).toBe(400);
  });
});

describe("managing passkeys", () => {
  test("lists only the caller's own, without the public key or counter", async () => {
    const mine = await registerUser();
    const theirs = await registerUser();
    await storePasskey(mine.id, "mine-1");
    await storePasskey(theirs.id, "theirs-1");

    const body = await readJson(await LIST(authed(mine.token, "/api/auth/passkeys")));
    expect(body.passkeys).toHaveLength(1);
    expect(body.passkeys[0].label).toBe("Test key");

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("publicKey");
    expect(serialized).not.toContain("counter");
  });

  test("cannot delete someone else's passkey", async () => {
    const mine = await registerUser();
    const theirs = await registerUser();
    const victim = await storePasskey(theirs.id, "theirs-1");

    const res = await REMOVE(
      jsonRequest("DELETE", `/api/auth/passkeys/${victim.id}`, undefined, {
        Authorization: `Bearer ${mine.token}`,
      }),
      { params: Promise.resolve({ id: victim.id }) },
    );
    expect(res.status).toBe(404);
    expect(await db.passkey.count({ where: { id: victim.id } })).toBe(1);
  });

  test("deletes the caller's own", async () => {
    const user = await registerUser();
    const key = await storePasskey(user.id);

    const res = await REMOVE(
      jsonRequest("DELETE", `/api/auth/passkeys/${key.id}`, undefined, {
        Authorization: `Bearer ${user.token}`,
      }),
      { params: Promise.resolve({ id: key.id }) },
    );
    expect(res.status).toBe(200);
    expect(await db.passkey.count({ where: { id: key.id } })).toBe(0);
  });
});
