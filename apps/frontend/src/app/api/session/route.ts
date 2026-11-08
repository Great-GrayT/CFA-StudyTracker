import { NextRequest } from "next/server";
import { z } from "zod";
import { backendBase, setToken, clearToken } from "@/lib/session";

// Sign in and register live here rather than behind the generic proxy because
// their response body carries the token. It has to be captured into the
// httpOnly cookie server side; passing it through would hand the client the
// exact credential the cookie exists to hide.

const credentials = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  mode: z.enum(["login", "register"]),
});

export async function POST(req: NextRequest): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const parsed = credentials.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { email, password, mode } = parsed.data;

  const res = await fetch(`${backendBase()}/api/auth/${mode}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
    cache: "no-store",
  });

  if (!res.ok) {
    // Pass the backend's status through so the copy deck can tell 401 (wrong
    // credentials) from 409 (email taken) from 429 (rate limited).
    let message = "Something went wrong.";
    try {
      const err = (await res.json()) as { error?: string };
      if (err?.error) message = err.error;
    } catch {
      // A malformed body makes the backend throw, which surfaces as a framework
      // 500 with an HTML body. Keep the generic message rather than parsing it.
    }
    return Response.json({ error: message }, { status: res.status });
  }

  const data = (await res.json()) as {
    token?: string;
    mfaRequired?: boolean;
    mfaToken?: string;
  };

  // A two-step account gets no cookie here: the password was right, but the
  // bearer is not signed in until the second step. The mfaToken is passed to
  // the client deliberately, because it is scoped so the API refuses it as a
  // session; it can only be exchanged at /api/session/mfa.
  if (data.mfaRequired && data.mfaToken) {
    return Response.json({ mfaRequired: true, mfaToken: data.mfaToken }, { status: 200 });
  }

  if (!data.token) {
    return Response.json({ error: "Sign in failed." }, { status: 502 });
  }

  await setToken(data.token);
  return Response.json({ ok: true }, { status: mode === "register" ? 201 : 200 });
}

export async function DELETE(): Promise<Response> {
  await clearToken();
  return Response.json({ ok: true }, { status: 200 });
}
