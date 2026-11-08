// Hand-rolled HS256 JWT (deliberately not a JWT library). verifyJwt never
// reads or branches on the token's own header - it always recomputes an
// HMAC-SHA256 signature itself with the server's secret. That is what makes
// this immune to alg:none / algorithm-confusion attacks: a client-controlled
// header can never talk the verifier into a weaker (or no) algorithm.
import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "./db";

const DEFAULT_TTL_HOURS = 72;

interface JwtPayload {
  userId: string;
  tokenVersion: number;
  /**
   * What the token is allowed to do.
   *
   * Absent or "access" means a full session. "mfa" means the password was
   * correct but the second step is outstanding, so the bearer is NOT signed in
   * yet. requireUser rejects anything that is not a full session, which is the
   * whole reason this field exists: without it an intermediate token would be
   * indistinguishable from a real one and two-step sign in would be bypassable
   * by simply using the token it hands out.
   */
  scope?: "access" | "mfa";
}

function getSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET environment variable is not set");
  }
  return secret;
}

function defaultTtlSeconds(): number {
  const hours = Number(process.env.JWT_TTL_HOURS);
  const validHours = Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_TTL_HOURS;
  return validHours * 3600;
}

function base64url(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

function sign(headerAndPayload: string, secret: string): string {
  return createHmac("sha256", secret).update(headerAndPayload).digest("base64url");
}

export function signJwt(payload: JwtPayload, options?: { ttlSeconds?: number }): string {
  const secret = getSecret();
  const ttlSeconds = options?.ttlSeconds ?? defaultTtlSeconds();
  const nowSeconds = Math.floor(Date.now() / 1000);

  // typ/alg here are just conventional JWT shape; the "alg" value is never
  // read back on verification, only ever recomputed as HS256 below.
  const headerPart = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payloadPart = base64url(
    JSON.stringify({ ...payload, exp: nowSeconds + ttlSeconds }),
  );
  const signaturePart = sign(`${headerPart}.${payloadPart}`, secret);

  return `${headerPart}.${payloadPart}.${signaturePart}`;
}

export function verifyJwt(token: string): JwtPayload | null {
  const secret = getSecret();
  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }
  const [headerPart, payloadPart, signaturePart] = parts;

  // Recompute the signature ourselves over the header/payload we were given -
  // headerPart's content (e.g. a forged "alg":"none") is never inspected or
  // trusted, it is only ever treated as opaque bytes to re-sign.
  const expectedSignature = sign(`${headerPart}.${payloadPart}`, secret);
  const expectedBuf = Buffer.from(expectedSignature, "utf8");
  const actualBuf = Buffer.from(signaturePart, "utf8");
  if (expectedBuf.length !== actualBuf.length || !timingSafeEqual(expectedBuf, actualBuf)) {
    return null;
  }

  let decoded: Partial<JwtPayload & { exp: unknown }>;
  try {
    decoded = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (typeof decoded.userId !== "string" || typeof decoded.tokenVersion !== "number") {
    return null;
  }
  if (decoded.scope !== undefined && decoded.scope !== "access" && decoded.scope !== "mfa") {
    return null;
  }
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (typeof decoded.exp !== "number" || decoded.exp < nowSeconds) {
    return null;
  }

  // scope must be carried through: dropping it here would make every token
  // look like a full session to the callers below, silently defeating the
  // two-step check.
  return {
    userId: decoded.userId,
    tokenVersion: decoded.tokenVersion,
    scope: decoded.scope,
  };
}

// Every protected route's auth check. A verified JWT alone is not enough:
// tokenVersion is re-checked against the current DB row so that revoking a
// user (bumping tokenVersion, e.g. on password change / logout-everywhere)
// immediately invalidates tokens already issued, without needing a separate
// token-blocklist.
export async function requireUser(req: Request): Promise<{ userId: string } | null> {
  const header = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!header || !header.startsWith("Bearer ")) {
    return null;
  }
  const token = header.slice("Bearer ".length).trim();
  if (!token) {
    return null;
  }

  const payload = verifyJwt(token);
  if (!payload) {
    return null;
  }

  // Fail closed on anything that is not a full session. An mfa-scoped token
  // proves a password, not an identity.
  if (payload.scope === "mfa") {
    return null;
  }

  const user = await db.user.findUnique({ where: { id: payload.userId } });
  if (!user || user.tokenVersion !== payload.tokenVersion) {
    return null;
  }

  return { userId: user.id };
}

// OAuth sign-in find-or-create. An existing OAuthAccount (provider +
// providerAccountId) always wins - it's the durable link, keyed off the
// provider's own stable account id rather than email, which a user can
// change at the provider. Only when no such link exists yet do we fall
// back to matching by email, so someone who registered with a password
// and later signs in via OAuth lands on the same account instead of a
// duplicate; if no user has that email either, a new passwordless one is
// created and linked.
export async function linkOrCreateOauthUser(
  provider: string,
  providerAccountId: string,
  email: string,
): Promise<{ id: string; tokenVersion: number }> {
  const existingAccount = await db.oAuthAccount.findUnique({
    where: { provider_providerAccountId: { provider, providerAccountId } },
  });
  if (existingAccount) {
    const user = await db.user.findUniqueOrThrow({ where: { id: existingAccount.userId } });
    return { id: user.id, tokenVersion: user.tokenVersion };
  }

  const user = await db.user.upsert({
    where: { email },
    update: {},
    create: { email },
  });

  await db.oAuthAccount.create({
    data: { provider, providerAccountId, userId: user.id },
  });

  return { id: user.id, tokenVersion: user.tokenVersion };
}

/**
 * Verifies a short-lived token issued between the password step and the
 * second step of sign in.
 *
 * Deliberately separate from requireUser: these two must never accept each
 * other's tokens, and expressing that as one function with a flag is how the
 * flag eventually gets passed wrong.
 */
export async function requireMfaToken(token: string): Promise<{ userId: string } | null> {
  const payload = verifyJwt(token);
  if (!payload || payload.scope !== "mfa") {
    return null;
  }
  const user = await db.user.findUnique({ where: { id: payload.userId } });
  if (!user || user.tokenVersion !== payload.tokenVersion) {
    return null;
  }
  return { userId: user.id };
}

/** Five minutes is long enough to read a code off a phone, short enough to matter. */
export const MFA_TOKEN_TTL_SECONDS = 300;
