import { randomUUID } from "node:crypto";
import { db } from "../../src/lib/db";
import { POST as REGISTER } from "../../src/app/api/auth/register/route";
import { POST as CREATE_PLAN } from "../../src/app/api/plans/route";
import { GET as LIST_LOGS, POST as CREATE_LOG } from "../../src/app/api/logs/route";
import { jsonRequest, readJson } from "./request";

/**
 * Shared test fixtures for Task 9's route tests (and anything downstream
 * that exercises the same plan/package/log tables). Task 9's brief
 * references these names without defining them; built here as normal
 * test-suite growth.
 */

export const fullWeek = { mon: 2, tue: 2, wed: 2, thu: 2, fri: 2, sat: 2, sun: 2 };

export type RegisteredUser = { id: string; email: string; token: string };

/** Registers a brand-new user through the real register route, returning its id (looked up in the DB, since the route only returns a token) and token. */
export async function registerUser(): Promise<RegisteredUser> {
  const email = `user-${randomUUID()}@test.com`;
  const password = "correct-horse-battery";
  const res = await REGISTER(jsonRequest("POST", "/api/auth/register", { email, password }));
  const body = await readJson(res);
  const user = await db.user.findUniqueOrThrow({ where: { email } });
  return { id: user.id, email, token: body.token as string };
}

/**
 * Builds an authenticated Request for a route handler called directly (no
 * Next.js router involved), so the Request's own `.method` is never read by
 * any handler here - it only needs to not reject a GET-with-body at
 * construction time. Defaults to POST when a body is given, GET otherwise;
 * pass `method` explicitly to override.
 */
export function authedRequest(
  user: RegisteredUser,
  url: string,
  body?: unknown,
  method?: string,
): Request {
  const resolvedMethod = method ?? (body !== undefined ? "POST" : "GET");
  return jsonRequest(resolvedMethod, url, body, { Authorization: `Bearer ${user.token}` });
}

/**
 * Ensures at least one LOS row exists under the given level, inserting a
 * minimal Level/Topic/Reading/LOS chain directly if the test DB (unlike the
 * dev DB) has no curriculum seeded yet. Idempotent: reuses existing rows.
 */
export async function anyLosIdForLevel(levelId: "I" | "II" | "III" = "I"): Promise<string> {
  const existing = await db.lOS.findFirst({ where: { reading: { topic: { levelId } } } });
  if (existing) return existing.id;

  await db.level.upsert({ where: { id: levelId }, create: { id: levelId }, update: {} });
  const topic = await db.topic.create({
    data: { levelId, name: "Test Topic", order: 1, examWeightMin: 1, examWeightMax: 1 },
  });
  const reading = await db.reading.create({
    data: { topicId: topic.id, name: "Test Reading", order: 1 },
  });
  const los = await db.lOS.create({
    data: { readingId: reading.id, text: "Test LOS", order: 1 },
  });
  return los.id;
}

/** Creates a plan via the real POST /api/plans route, returning the parsed plan JSON. */
export async function createPlan(user: RegisteredUser, body: Record<string, unknown>): Promise<any> {
  const res = await CREATE_PLAN(authedRequest(user, "/api/plans", body));
  return readJson(res);
}

/**
 * All of the user's plans (active and inactive), read straight from the DB -
 * there is no "list all plans" route (GET /api/plans only returns the single
 * active one), so assertions about deactivation need this direct query.
 */
export async function listPlansForUser(user: RegisteredUser): Promise<any[]> {
  return db.studyPlan.findMany({ where: { userId: user.id } });
}

/** Registers a user, ensures Level I curriculum exists, and creates a plan for them in one step. */
export async function setupUserWithPlan(
  opts: Partial<{
    levelId: string;
    examDate: string;
    startDate: string;
    weeklyAvailability: typeof fullWeek;
  }> = {},
): Promise<{ user: RegisteredUser; plan: any; losId: string }> {
  const user = await registerUser();
  const losId = await anyLosIdForLevel("I");
  const plan = await createPlan(user, {
    levelId: opts.levelId ?? "I",
    examDate: opts.examDate ?? "2027-06-01",
    startDate: opts.startDate,
    weeklyAvailability: opts.weeklyAvailability ?? fullWeek,
  });
  return { user, plan, losId };
}

/** Returns an existing preset (userId: null) StudyPackage, creating one if the test DB has none yet. */
export async function anyPresetPackage(): Promise<any> {
  const existing = await db.studyPackage.findFirst({ where: { userId: null } });
  if (existing) return existing;
  return db.studyPackage.create({ data: { name: "UWorld", userId: null } });
}

/** POSTs a log entry via the real route, returning the raw Response (callers assert on status for validation-boundary tests). */
export async function createLog(user: RegisteredUser, body: Record<string, unknown>): Promise<Response> {
  return CREATE_LOG(authedRequest(user, "/api/logs", body));
}

/**
 * Lists a plan's log entries via the real route, unwrapping the paginated
 * `{ items, nextCursor }` envelope and reviving `date` back into a real Date
 * (JSON only ever carries it as a string) so callers can assert against
 * `new Date(...)` literals the way the brief's tests do.
 */
export async function listLogs(user: RegisteredUser, planId: string): Promise<any[]> {
  const res = await LIST_LOGS(authedRequest(user, `/api/logs?planId=${planId}`));
  const body = await readJson(res);
  return body.items.map((item: any) => ({ ...item, date: new Date(item.date) }));
}
