import { cookies } from "next/headers";

// The whole point of the proxy: this cookie is httpOnly, so the bearer token is
// never readable from JavaScript. An XSS on this origin can still *send*
// requests while the page is open, but it cannot exfiltrate a credential that
// keeps working elsewhere afterwards. That difference in blast radius is why
// this costs a hop.
export const SESSION_COOKIE = "cfa_session";

// Mirrors the backend's JWT lifetime. Kept as a named constant because two
// places need it and a mismatch would log people out early for no reason.
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_MAX_AGE,
  };
}

export async function getToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value ?? null;
}

export async function setToken(token: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, sessionCookieOptions());
}

export async function clearToken(): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, "", { ...sessionCookieOptions(), maxAge: 0 });
}

export function backendBase(): string {
  const base = process.env.BACKEND_BASE_URL;
  if (!base) {
    throw new Error("BACKEND_BASE_URL is not set");
  }
  return base.replace(/\/$/, "");
}
