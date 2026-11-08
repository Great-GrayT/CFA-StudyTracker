import { startRegistration, startAuthentication } from "@simplewebauthn/browser";
import { api, ApiError } from "./api";

// Client helpers for passkeys and two-step sign in.
//
// Every one of these ends at a same-origin route, never at the API directly,
// so no credential is ever held in client JavaScript.

export type SignInResult = { ok: true } | { mfaRequired: true; mfaToken: string };

/** True when this browser can do WebAuthn at all. */
export function isPasskeySupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.PublicKeyCredential === "function" &&
    typeof navigator.credentials?.create === "function"
  );
}

/**
 * True when the device has a built-in authenticator (Face ID, Touch ID,
 * Windows Hello). Offering a passkey on a machine with no authenticator
 * produces a dialog that can only be cancelled.
 */
export async function isPlatformAuthenticatorAvailable(): Promise<boolean> {
  if (!isPasskeySupported()) return false;
  try {
    return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

export async function registerPasskey(label?: string): Promise<void> {
  const options = await api.post<Record<string, unknown>>("auth/passkey/register-options", {});
  const response = await startRegistration({ optionsJSON: options as never });
  await api.post("auth/passkey/register-verify", { response, label });
}

/**
 * Passkey sign in.
 *
 * Discoverable: no email is asked for first, because naming the credentials
 * for an address would let anyone test whether that address has an account.
 */
export async function signInWithPasskey(): Promise<void> {
  const options = await api.post<Record<string, unknown>>("auth/passkey/login-options", {});
  const response = await startAuthentication({ optionsJSON: options as never });

  const res = await fetch("/api/session/mfa", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "passkey", response }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(res.status, body.error ?? "That passkey was not recognised.");
  }
}

/** Exchange the intermediate token plus a code for a real session. */
export async function completeTwoStep(
  mfaToken: string,
  code: string,
): Promise<{ recoveryCodesRemaining: number | null }> {
  const res = await fetch("/api/session/mfa", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "totp", mfaToken, code }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    error?: string;
    recoveryCodesRemaining?: number | null;
  };
  if (!res.ok) {
    throw new ApiError(res.status, body.error ?? "That code is not right.");
  }
  return { recoveryCodesRemaining: body.recoveryCodesRemaining ?? null };
}
