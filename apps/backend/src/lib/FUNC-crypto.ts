// Password hashing: scrypt (Node's memory-hard KDF) with a per-password random
// salt, stored alongside the derived key as `salt:hash` (both hex). Comparison
// is constant-time via timingSafeEqual - never string equality - so a wrong
// guess can't be distinguished from a right one by response time.
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);

// 64-byte derived key; Node's scrypt defaults (N=16384, r=8, p=1) are used
// for the cost parameters, matching the Node crypto docs' own password-hash example.
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH).toString("hex");
  const derived = (await scryptAsync(plain, salt, KEY_LENGTH)) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  const [salt, storedHex] = hash.split(":");
  if (!salt || !storedHex) {
    return false;
  }

  const stored = Buffer.from(storedHex, "hex");
  const derived = (await scryptAsync(plain, salt, stored.length)) as Buffer;

  // Lengths always match here (both derived with stored.length as keylen),
  // but guard anyway: timingSafeEqual throws on mismatched buffer lengths.
  if (derived.length !== stored.length) {
    return false;
  }
  return timingSafeEqual(derived, stored);
}
