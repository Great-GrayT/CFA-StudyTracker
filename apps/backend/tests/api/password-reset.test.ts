import { describe, test, expect, beforeEach, vi } from "vitest";
import { createHash } from "node:crypto";
import { db } from "../../src/lib/db";
import { resetDb } from "../helpers/test-db";
import { jsonRequest, readJson } from "../helpers/request";
import { registerUser } from "../helpers/fixtures";
import { POST as FORGOT } from "../../src/app/api/auth/forgot-password/route";
import { POST as RESET } from "../../src/app/api/auth/reset-password/route";
import { POST as LOGIN } from "../../src/app/api/auth/login/route";
import * as mailer from "../../src/lib/FUNC-mail";

const PASSWORD = "correct-horse-battery";
const NEW_PASSWORD = "a-brand-new-password";

function sentToken(spy: ReturnType<typeof vi.spyOn>): string {
  const call = spy.mock.calls.at(-1);
  if (!call) throw new Error("no mail was sent");
  const body = (call[0] as { text: string }).text;
  const match = body.match(/token=([A-Za-z0-9_-]+)/);
  if (!match) throw new Error(`no token in mail body: ${body}`);
  return match[1];
}

let mailSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  await resetDb();
  mailSpy = vi.spyOn(mailer, "sendMail").mockResolvedValue(undefined as never);
});

describe("POST /api/auth/forgot-password", () => {
  test("issues a token and mails it for a real account", async () => {
    const user = await registerUser();
    const res = await FORGOT(
      jsonRequest("POST", "/api/auth/forgot-password", { email: user.email }),
    );
    expect(res.status).toBe(200);
    expect(mailSpy).toHaveBeenCalledTimes(1);
    expect(await db.passwordResetToken.count({ where: { userId: user.id } })).toBe(1);
  });

  test("answers identically for an unknown email, so it cannot enumerate accounts", async () => {
    const known = await registerUser();
    const a = await FORGOT(jsonRequest("POST", "/api/auth/forgot-password", { email: known.email }));
    const b = await FORGOT(
      jsonRequest("POST", "/api/auth/forgot-password", { email: "nobody@example.com" }),
    );
    expect(a.status).toBe(b.status);
    expect(await readJson(a)).toEqual(await readJson(b));
    // And no mail for the address that does not exist.
    expect(mailSpy).toHaveBeenCalledTimes(1);
  });

  test("stores only a hash, never the token itself", async () => {
    const user = await registerUser();
    await FORGOT(jsonRequest("POST", "/api/auth/forgot-password", { email: user.email }));
    const token = sentToken(mailSpy);
    const row = await db.passwordResetToken.findFirstOrThrow({ where: { userId: user.id } });

    expect(row.tokenHash).not.toBe(token);
    expect(row.tokenHash).toBe(createHash("sha256").update(token).digest("hex"));
  });

  test("issues a token that expires", async () => {
    const user = await registerUser();
    await FORGOT(jsonRequest("POST", "/api/auth/forgot-password", { email: user.email }));
    const row = await db.passwordResetToken.findFirstOrThrow({ where: { userId: user.id } });
    expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now());
    // An hour is the ceiling: a reset link is a bearer credential for the account.
    expect(row.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 60 * 60 * 1000 + 5000);
  });

  test("a second request invalidates the first token, so only the newest link works", async () => {
    const user = await registerUser();
    await FORGOT(jsonRequest("POST", "/api/auth/forgot-password", { email: user.email }));
    const first = sentToken(mailSpy);
    await FORGOT(jsonRequest("POST", "/api/auth/forgot-password", { email: user.email }));

    const res = await RESET(
      jsonRequest("POST", "/api/auth/reset-password", { token: first, password: NEW_PASSWORD }),
    );
    expect(res.status).toBe(400);
  });

  test("rejects a malformed email with 400", async () => {
    const res = await FORGOT(jsonRequest("POST", "/api/auth/forgot-password", { email: "nope" }));
    expect(res.status).toBe(400);
  });

  test("does not mail an OAuth-only account, which has no password to reset", async () => {
    const user = await db.user.create({
      data: { email: "oauth-only@example.com", passwordHash: null },
    });
    const res = await FORGOT(
      jsonRequest("POST", "/api/auth/forgot-password", { email: user.email }),
    );
    // Still a 200: the response must not reveal how the account signs in.
    expect(res.status).toBe(200);
    expect(mailSpy).not.toHaveBeenCalled();
  });

  test("a mail failure does not leak that the address exists", async () => {
    mailSpy.mockRejectedValueOnce(new Error("smtp down") as never);
    const user = await registerUser();
    const res = await FORGOT(
      jsonRequest("POST", "/api/auth/forgot-password", { email: user.email }),
    );
    expect(res.status).toBe(200);
  });
});

describe("POST /api/auth/reset-password", () => {
  async function requestReset() {
    const user = await registerUser();
    await FORGOT(jsonRequest("POST", "/api/auth/forgot-password", { email: user.email }));
    return { user, token: sentToken(mailSpy) };
  }

  test("sets the new password and lets the user log in with it", async () => {
    const { user, token } = await requestReset();
    const res = await RESET(
      jsonRequest("POST", "/api/auth/reset-password", { token, password: NEW_PASSWORD }),
    );
    expect(res.status).toBe(200);

    const ok = await LOGIN(
      jsonRequest("POST", "/api/auth/login", { email: user.email, password: NEW_PASSWORD }),
    );
    expect(ok.status).toBe(200);
  });

  test("the old password stops working", async () => {
    const { user, token } = await requestReset();
    await RESET(jsonRequest("POST", "/api/auth/reset-password", { token, password: NEW_PASSWORD }));

    const old = await LOGIN(
      jsonRequest("POST", "/api/auth/login", { email: user.email, password: PASSWORD }),
    );
    expect(old.status).toBe(401);
  });

  test("bumps tokenVersion, so every session opened before the reset is revoked", async () => {
    const { user, token } = await requestReset();
    const before = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    await RESET(jsonRequest("POST", "/api/auth/reset-password", { token, password: NEW_PASSWORD }));
    const after = await db.user.findUniqueOrThrow({ where: { id: user.id } });

    // This is the point of a reset: whoever was in the account is now out.
    expect(after.tokenVersion).toBeGreaterThan(before.tokenVersion);
  });

  test("is single use", async () => {
    const { token } = await requestReset();
    const first = await RESET(
      jsonRequest("POST", "/api/auth/reset-password", { token, password: NEW_PASSWORD }),
    );
    expect(first.status).toBe(200);

    const replay = await RESET(
      jsonRequest("POST", "/api/auth/reset-password", { token, password: "yet-another-password" }),
    );
    expect(replay.status).toBe(400);
  });

  test("rejects an expired token", async () => {
    const { user, token } = await requestReset();
    await db.passwordResetToken.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const res = await RESET(
      jsonRequest("POST", "/api/auth/reset-password", { token, password: NEW_PASSWORD }),
    );
    expect(res.status).toBe(400);
  });

  test("rejects an invented token", async () => {
    await requestReset();
    const res = await RESET(
      jsonRequest("POST", "/api/auth/reset-password", {
        token: "not-a-real-token-at-all",
        password: NEW_PASSWORD,
      }),
    );
    expect(res.status).toBe(400);
  });

  test("rejects a password shorter than the register route would accept", async () => {
    const { token } = await requestReset();
    const res = await RESET(
      jsonRequest("POST", "/api/auth/reset-password", { token, password: "short" }),
    );
    expect(res.status).toBe(400);
    // And the token survives, so a typo does not burn the link.
    const row = await db.passwordResetToken.findFirstOrThrow({});
    expect(row.usedAt).toBeNull();
  });
});
