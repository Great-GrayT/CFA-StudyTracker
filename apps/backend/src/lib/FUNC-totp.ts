import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { generateSecret as otpGenerateSecret, generateURI, verifySync } from "otplib";

// Two-step sign in, TOTP (RFC 6238), the thing every authenticator app speaks.
//
// otplib 13 exposes a functional API rather than the `authenticator` singleton
// of earlier versions, so options are passed per call instead of set globally.
// That is better here: nothing can change the verification window from a
// distance.

const ISSUER = "CFA Study Tracker";

// 30 seconds of tolerance either side, which is one TOTP step. Phone clocks
// drift, and refusing a code that was correct four seconds ago produces
// support tickets rather than security.
const EPOCH_TOLERANCE_SECONDS = 30;

const RECOVERY_CODE_COUNT = 10;

export function generateSecret(): string {
  return otpGenerateSecret();
}

/**
 * The otpauth:// URI an authenticator app scans.
 *
 * The issuer and label land in the app's list, so a user with several accounts
 * can tell them apart. Getting this wrong yields a working code under an
 * unidentifiable name.
 */
export function otpauthUri(email: string, secret: string): string {
  return generateURI({ strategy: "totp", issuer: ISSUER, label: email, secret });
}

export function verifyTotp(token: string, secret: string): boolean {
  const cleaned = token.replace(/\s/g, "");
  if (!/^\d{6}$/.test(cleaned)) return false;
  try {
    const result = verifySync({
      strategy: "totp",
      token: cleaned,
      secret,
      epochTolerance: EPOCH_TOLERANCE_SECONDS,
    });
    return result.valid === true;
  } catch {
    // Throws on a malformed secret rather than returning a falsy result.
    return false;
  }
}

/**
 * Recovery codes, returned in plaintext ONCE and stored only as hashes.
 *
 * Split by a dash so they can be read aloud or copied without losing place.
 * SHA-256 rather than scrypt for the same reason as the password reset token:
 * these are high-entropy random values, so there is nothing to brute force and
 * a slow KDF would only add latency.
 */
export function generateRecoveryCodes(): string[] {
  return Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    const raw = randomBytes(5).toString("hex").toUpperCase();
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}

export function hashRecoveryCode(code: string): string {
  return createHash("sha256").update(normaliseRecoveryCode(code)).digest("hex");
}

/** Case and dashes are presentation, not secret material. */
export function normaliseRecoveryCode(code: string): string {
  return code.replace(/[\s-]/g, "").toUpperCase();
}

/**
 * Constant-time compare for two hex digests.
 *
 * A plain === on a hash leaks its prefix through timing. Cheap to do properly.
 */
export function hashesMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return timingSafeEqual(bufA, bufB);
}
