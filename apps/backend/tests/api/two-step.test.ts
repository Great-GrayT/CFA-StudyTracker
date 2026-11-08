import { describe, test, expect, beforeEach } from "vitest";
import { db } from "../../src/lib/db";
import { resetDb } from "../helpers/test-db";
import { jsonRequest, readJson } from "../helpers/request";
import { registerUser } from "../helpers/fixtures";
import { generateSync } from "otplib";
import { POST as LOGIN } from "../../src/app/api/auth/login/route";
import { POST as SETUP } from "../../src/app/api/auth/2fa/setup/route";
import { POST as ENABLE } from "../../src/app/api/auth/2fa/enable/route";
import { POST as DISABLE } from "../../src/app/api/auth/2fa/disable/route";
import { POST as VERIFY } from "../../src/app/api/auth/2fa/verify/route";
import { GET as ME } from "../../src/app/api/auth/me/route";

const PASSWORD = "correct-horse-battery";

function authed(token: string, url: string, body?: unknown): Request {
  return jsonRequest(body ? "POST" : "GET", url, body, { Authorization: `Bearer ${token}` });
}

function codeFor(secret: string): string {
  return generateSync({ strategy: "totp", secret });
}

/** Walks a user all the way to two-step enabled, returning the pieces. */
async function enableTwoStep() {
  const user = await registerUser();
  const setup = await readJson(await SETUP(authed(user.token, "/api/auth/2fa/setup", {})));
  const secret = setup.secret as string;
  const res = await ENABLE(authed(user.token, "/api/auth/2fa/enable", { code: codeFor(secret) }));
  const body = await readJson(res);
  return { user, secret, recoveryCodes: body.recoveryCodes as string[] };
}

beforeEach(async () => {
  await resetDb();
});

describe("setting up two-step sign in", () => {
  test("setup issues a secret but does not turn it on yet", async () => {
    const user = await registerUser();
    const res = await SETUP(authed(user.token, "/api/auth/2fa/setup", {}));
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.secret).toBeTypeOf("string");
    expect(body.otpauthUri).toContain("otpauth://totp/");

    // Not enabled until a code proves the app holds the secret: enabling on
    // setup would lock out anyone who closed the tab before scanning.
    const row = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.totpEnabledAt).toBeNull();
  });

  test("enable rejects a wrong code and stays off", async () => {
    const user = await registerUser();
    await SETUP(authed(user.token, "/api/auth/2fa/setup", {}));
    const res = await ENABLE(authed(user.token, "/api/auth/2fa/enable", { code: "000000" }));
    expect(res.status).toBe(400);
    const row = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.totpEnabledAt).toBeNull();
  });

  test("enable turns it on and returns recovery codes once", async () => {
    const { user, recoveryCodes } = await enableTwoStep();
    expect(recoveryCodes).toHaveLength(10);
    const row = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.totpEnabledAt).not.toBeNull();
  });

  test("recovery codes are stored hashed, never in plaintext", async () => {
    const { user, recoveryCodes } = await enableTwoStep();
    const stored = await db.recoveryCode.findMany({ where: { userId: user.id } });
    expect(stored).toHaveLength(10);
    for (const row of stored) {
      expect(recoveryCodes).not.toContain(row.codeHash);
    }
  });

  test("setup cannot be rerun while it is on, which would strand the live app", async () => {
    const { user } = await enableTwoStep();
    const res = await SETUP(authed(user.token, "/api/auth/2fa/setup", {}));
    expect(res.status).toBe(409);
  });
});

describe("signing in with two-step on", () => {
  test("the password step no longer returns an access token", async () => {
    const { user } = await enableTwoStep();
    const res = await LOGIN(
      jsonRequest("POST", "/api/auth/login", { email: user.email, password: PASSWORD }),
    );
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.mfaRequired).toBe(true);
    expect(body.token).toBeUndefined();
    expect(body.mfaToken).toBeTypeOf("string");
  });

  test("the intermediate token CANNOT be used as a session", async () => {
    // The whole feature rests on this. If an mfa-scoped token were accepted by
    // requireUser, two-step would be bypassable by using the token the
    // password step already handed out.
    const { user } = await enableTwoStep();
    const login = await readJson(
      await LOGIN(jsonRequest("POST", "/api/auth/login", { email: user.email, password: PASSWORD })),
    );
    const res = await ME(authed(login.mfaToken as string, "/api/auth/me"));
    expect(res.status).toBe(401);
  });

  test("a correct code exchanges it for a real session", async () => {
    const { user, secret } = await enableTwoStep();
    const login = await readJson(
      await LOGIN(jsonRequest("POST", "/api/auth/login", { email: user.email, password: PASSWORD })),
    );
    const res = await VERIFY(
      jsonRequest("POST", "/api/auth/2fa/verify", {
        mfaToken: login.mfaToken,
        code: codeFor(secret),
      }),
    );
    expect(res.status).toBe(200);
    const body = await readJson(res);

    const me = await ME(authed(body.token as string, "/api/auth/me"));
    expect(me.status).toBe(200);
  });

  test("a wrong code does not", async () => {
    const { user } = await enableTwoStep();
    const login = await readJson(
      await LOGIN(jsonRequest("POST", "/api/auth/login", { email: user.email, password: PASSWORD })),
    );
    const res = await VERIFY(
      jsonRequest("POST", "/api/auth/2fa/verify", { mfaToken: login.mfaToken, code: "000000" }),
    );
    expect(res.status).toBe(400);
  });

  test("an access token cannot stand in for the mfa token", async () => {
    const plain = await registerUser();
    const { user, secret } = await enableTwoStep();
    const res = await VERIFY(
      jsonRequest("POST", "/api/auth/2fa/verify", {
        mfaToken: plain.token,
        code: codeFor(secret),
      }),
    );
    expect(res.status).toBe(401);
    expect(user).toBeDefined();
  });

  test("a recovery code works and is single use", async () => {
    const { user, recoveryCodes } = await enableTwoStep();

    async function attempt(code: string) {
      const login = await readJson(
        await LOGIN(
          jsonRequest("POST", "/api/auth/login", { email: user.email, password: PASSWORD }),
        ),
      );
      return VERIFY(
        jsonRequest("POST", "/api/auth/2fa/verify", { mfaToken: login.mfaToken, code }),
      );
    }

    const first = await attempt(recoveryCodes[0]);
    expect(first.status).toBe(200);
    expect((await readJson(first)).recoveryCodesRemaining).toBe(9);

    const replay = await attempt(recoveryCodes[0]);
    expect(replay.status).toBe(400);
  });

  test("a recovery code is accepted however it is spaced or cased", async () => {
    const { user, recoveryCodes } = await enableTwoStep();
    const login = await readJson(
      await LOGIN(jsonRequest("POST", "/api/auth/login", { email: user.email, password: PASSWORD })),
    );
    const messy = recoveryCodes[1].toLowerCase().replace("-", " ");
    const res = await VERIFY(
      jsonRequest("POST", "/api/auth/2fa/verify", { mfaToken: login.mfaToken, code: messy }),
    );
    expect(res.status).toBe(200);
  });

  test("an account without two-step still signs in one step", async () => {
    const user = await registerUser();
    const res = await LOGIN(
      jsonRequest("POST", "/api/auth/login", { email: user.email, password: PASSWORD }),
    );
    const body = await readJson(res);
    expect(body.token).toBeTypeOf("string");
    expect(body.mfaRequired).toBeUndefined();
  });
});

describe("turning two-step off", () => {
  test("requires the password, not merely a session", async () => {
    // A stolen unlocked device has a session. Turning off the second factor is
    // exactly what its thief would do next.
    const { user } = await enableTwoStep();
    const res = await DISABLE(
      authed(user.token, "/api/auth/2fa/disable", { password: "not-the-password" }),
    );
    expect(res.status).toBe(400);
    const row = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.totpEnabledAt).not.toBeNull();
  });

  test("clears the secret and every recovery code", async () => {
    const { user } = await enableTwoStep();
    const res = await DISABLE(authed(user.token, "/api/auth/2fa/disable", { password: PASSWORD }));
    expect(res.status).toBe(200);

    const row = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.totpEnabledAt).toBeNull();
    expect(row.totpSecret).toBeNull();
    // Leaving these behind would let an old code sign in after a later re-enable.
    expect(await db.recoveryCode.count({ where: { userId: user.id } })).toBe(0);
  });
});
