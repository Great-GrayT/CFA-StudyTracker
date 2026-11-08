import { NextRequest } from "next/server";
import { backendBase, setToken } from "@/lib/session";

// The second step of sign in, and passkey sign in, both end in a token that
// must land in the httpOnly cookie rather than in client JavaScript. Same
// reasoning as /api/session: the client never holds the credential.
export async function POST(req: NextRequest): Promise<Response> {
  let body: { mode?: string; [k: string]: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { mode, ...rest } = body;
  const path =
    mode === "passkey" ? "auth/passkey/login-verify" : mode === "totp" ? "auth/2fa/verify" : null;
  if (!path) {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const res = await fetch(`${backendBase()}/api/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(rest),
    cache: "no-store",
  });

  if (!res.ok) {
    let message = "That did not work.";
    try {
      const err = (await res.json()) as { error?: string };
      if (err?.error) message = err.error;
    } catch {
      /* non-JSON body */
    }
    return Response.json({ error: message }, { status: res.status });
  }

  const data = (await res.json()) as { token?: string; recoveryCodesRemaining?: number };
  if (!data.token) {
    return Response.json({ error: "Sign in failed." }, { status: 502 });
  }

  await setToken(data.token);
  return Response.json(
    { ok: true, recoveryCodesRemaining: data.recoveryCodesRemaining ?? null },
    { status: 200 },
  );
}
