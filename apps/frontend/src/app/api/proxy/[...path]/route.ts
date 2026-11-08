import { NextRequest } from "next/server";
import { backendBase, getToken } from "@/lib/session";

// Same-origin proxy to the study-tracker API.
//
// The browser calls /api/proxy/progress?planId=x; this attaches the bearer
// token from the httpOnly cookie and forwards to the backend. Two things fall
// out of that: the token never reaches client JavaScript, and CORS stops being
// a frontend concern entirely, because the browser only ever talks to its own
// origin.
//
// Auth routes are deliberately NOT proxied here. They return a token in the
// body, which must be captured into the cookie rather than passed through to
// the client, so they get their own handlers under /api/session.

// An allowlist, not a passthrough. Without it this route would forward any path
// a caller invents, including ones added to the backend later that were never
// meant to be reachable from a browser (the cron tick is the live example: it
// is protected by a shared secret, not a user JWT).
const ALLOWED = [
  /^plans(\/|$)/,
  /^packages(\/|$)/,
  /^logs(\/|$)/,
  /^mock-exams(\/|$)/,
  /^progress$/,
  /^curriculum(\/|$)/,
  /^export\/(all|log)$/,
  /^push\/subscribe$/,
  /^push\/subscriptions(\/|$)/,
  /^cron\/(runs|run)$/,
  /^auth\/me$/,
  /^auth\/password$/,
];

function allowed(path: string): boolean {
  return ALLOWED.some((re) => re.test(path));
}

// Password reset is the one flow that must work WITHOUT a session: a user who
// has forgotten their password has no token to send. These forward unauthed.
const PUBLIC = [/^auth\/forgot-password$/, /^auth\/reset-password$/];

async function forward(req: NextRequest, path: string[]): Promise<Response> {
  const joined = path.join("/");
  const isPublic = PUBLIC.some((re) => re.test(joined));
  if (!isPublic && !allowed(joined)) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const token = await getToken();
  if (!isPublic && !token) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(`${backendBase()}/api/${joined}`);
  req.nextUrl.searchParams.forEach((v, k) => url.searchParams.append(k, v));

  const headers = new Headers();
  if (token) headers.set("authorization", `Bearer ${token}`);
  const contentType = req.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);

  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  const res = await fetch(url, {
    method: req.method,
    headers,
    body: hasBody ? await req.text() : undefined,
    // The backend is the source of truth and every response here is per-user.
    cache: "no-store",
  });

  // Stream the body through untouched. Status and content-type are preserved so
  // the client sees the backend's own errors rather than a flattened version,
  // which is what lets the copy deck distinguish a 403 from a 404.
  const out = new Headers();
  const ct = res.headers.get("content-type");
  if (ct) out.set("content-type", ct);
  const disposition = res.headers.get("content-disposition");
  if (disposition) out.set("content-disposition", disposition);
  const etag = res.headers.get("etag");
  if (etag) out.set("etag", etag);

  return new Response(res.body, { status: res.status, headers: out });
}

type Ctx = { params: Promise<{ path: string[] }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  return forward(req, (await ctx.params).path);
}
export async function POST(req: NextRequest, ctx: Ctx) {
  return forward(req, (await ctx.params).path);
}
export async function PATCH(req: NextRequest, ctx: Ctx) {
  return forward(req, (await ctx.params).path);
}
export async function DELETE(req: NextRequest, ctx: Ctx) {
  return forward(req, (await ctx.params).path);
}
