// Client-side API surface. Everything goes to the same-origin proxy, so there
// is no base URL to configure here and no token to attach: the proxy does both.

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

// Maps a status to the user-facing sentence from the copy deck. Kept in one
// place so the same failure never gets two different wordings.
export function messageForStatus(status: number, fallback?: string): string {
  switch (status) {
    case 401:
      return "That email and password do not match.";
    case 403:
      return "This plan is not yours to change.";
    case 404:
      return "No active plan. Set one up to start tracking.";
    case 409:
      return "An account already uses that email. Sign in instead?";
    case 429:
      return "Too many attempts. Try again in a minute.";
    case 500:
      // The backend throws on a malformed body before its own validation runs,
      // which surfaces as a framework 500. So a 500 here is not purely a server
      // fault and the copy must not promise it is.
      return "The server could not handle that. If it keeps happening, the request may be malformed rather than the server being down.";
    default:
      return fallback ?? "Something went wrong.";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/proxy/${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch {
    // fetch only rejects on a transport failure, which at this point means the
    // device is offline or the proxy is unreachable.
    throw new ApiError(0, "You are offline. This needs a connection to save.");
  }

  if (!res.ok) {
    let detail: string | undefined;
    try {
      const body = (await res.json()) as { error?: string };
      detail = body?.error;
    } catch {
      // Non-JSON error body, typically the framework 500 described above.
    }
    throw new ApiError(res.status, messageForStatus(res.status, detail));
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  del: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: "DELETE",
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
};

// Session routes are not proxied: they capture the token into the cookie.
export type SignInOutcome = { ok: true } | { mfaRequired: true; mfaToken: string };

export async function signIn(
  email: string,
  password: string,
  mode: "login" | "register",
): Promise<SignInOutcome> {
  const res = await fetch("/api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, mode }),
  });

  let body: { error?: string; mfaRequired?: boolean; mfaToken?: string } = {};
  try {
    body = (await res.json()) as typeof body;
  } catch {
    /* non-JSON body */
  }

  if (!res.ok) {
    throw new ApiError(res.status, messageForStatus(res.status, body.error));
  }
  // A correct password on a two-step account is not yet a session.
  if (body.mfaRequired && body.mfaToken) {
    return { mfaRequired: true, mfaToken: body.mfaToken };
  }
  return { ok: true };
}

export async function signOut(): Promise<void> {
  await fetch("/api/session", { method: "DELETE" });
}
