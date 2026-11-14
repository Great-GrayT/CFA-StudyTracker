// External trigger for one coach sweep (lib/FUNC-sweep.ts).
//
// The app now runs the sweep itself every 15 minutes (src/instrumentation.ts),
// so this route is a backup and a manual lever, not the schedule. Calling it
// alongside the in-process timer is safe: each coach slot is claimed by a
// unique row before anything is sent, and the snapshot upserts.
//
// Hit by a scheduler or an operator, not a browser, so it authenticates with a
// shared Bearer secret (CRON_SECRET) rather than a user JWT.
import { timingSafeEqual } from "node:crypto";
import { runSweep } from "../../../../lib/FUNC-sweep";

// Constant-time Bearer-secret check, mirroring verifyJwt's signature
// comparison: never compare a secret with ===, and guard the length before
// timingSafeEqual, which throws on a length mismatch.
function isAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const header = req.headers.get("authorization");
  if (!header || !header.startsWith("Bearer ")) return false;
  const token = header.slice("Bearer ".length).trim();
  if (!token) return false;

  const expectedBuf = Buffer.from(secret, "utf8");
  const actualBuf = Buffer.from(token, "utf8");
  if (expectedBuf.length !== actualBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}

export async function GET(req: Request): Promise<Response> {
  if (!isAuthorized(req)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runSweep();
  return Response.json({ ok: true, ...result }, { status: 200 });
}
