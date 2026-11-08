import { randomBytes } from "node:crypto";
import { db } from "./db";

// WebAuthn configuration and challenge storage.
//
// The relying party id is the registrable domain, WITHOUT scheme or port, and
// it must match the origin the browser is on or every ceremony fails with a
// message that does not say why. Deriving both from one env var is what stops
// them drifting apart.

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

export function rpOrigin(): string {
  const origin = process.env.FRONTEND_BASE_URL;
  if (!origin) throw new Error("FRONTEND_BASE_URL is not set");
  return origin.replace(/\/$/, "");
}

export function rpId(): string {
  return new URL(rpOrigin()).hostname;
}

export const RP_NAME = "CFA Study Tracker";

export type ChallengeKind = "register" | "login";

/**
 * Issues a challenge and records it server side.
 *
 * Kept in the database rather than a cookie or the response: a challenge the
 * client can choose or replay is not a challenge at all.
 */
export async function issueChallenge(kind: ChallengeKind, userId?: string): Promise<string> {
  const challenge = randomBytes(32).toString("base64url");
  await db.webAuthnChallenge.create({
    data: {
      challenge,
      kind,
      userId: userId ?? null,
      expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
    },
  });
  return challenge;
}

/**
 * Redeems a challenge, single use.
 *
 * Deleted rather than marked, because nothing ever needs to read a spent
 * challenge and leaving them around only grows the table.
 */
export async function consumeChallenge(
  challenge: string,
  kind: ChallengeKind,
): Promise<{ userId: string | null } | null> {
  const row = await db.webAuthnChallenge.findUnique({ where: { challenge } });
  if (!row || row.kind !== kind) return null;

  await db.webAuthnChallenge.delete({ where: { id: row.id } });

  if (row.expiresAt.getTime() < Date.now()) return null;
  return { userId: row.userId };
}

/** Opportunistic cleanup, so expired rows do not accumulate forever. */
export async function pruneChallenges(): Promise<void> {
  await db.webAuthnChallenge.deleteMany({ where: { expiresAt: { lt: new Date() } } });
}
