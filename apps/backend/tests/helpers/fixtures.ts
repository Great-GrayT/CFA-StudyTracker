import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { db } from "../../src/lib/db";
import { POST as REGISTER } from "../../src/app/api/auth/register/route";
import { POST as CREATE_PLAN } from "../../src/app/api/plans/route";
import { GET as LIST_LOGS, POST as CREATE_LOG } from "../../src/app/api/logs/route";
import { jsonRequest, readJson } from "./request";
import { seedPackages } from "../../prisma/seed-packages.ts";

/**
 * Shared test fixtures for Task 9's route tests (and anything downstream
 * that exercises the same plan/package/log tables). Task 9's brief
 * references these names without defining them; built here as normal
 * test-suite growth.
 */

export const fullWeek = { mon: 2, tue: 2, wed: 2, thu: 2, fri: 2, sat: 2, sun: 2 };
/** All zero: used by Task 10's pace-realism test to force remainingHours to 0. */
export const minimalWeek = { mon: 0, tue: 0, wed: 0, thu: 0, fri: 0, sat: 0, sun: 0 };
/** Sums to 9 (3+3+3), spread over three weekdays rather than evenly, to prove recommendedSplit sums the whole week rather than reading a single day. */
export const nineHoursPerWeek = { mon: 3, tue: 3, wed: 3, thu: 0, fri: 0, sat: 0, sun: 0 };

/** n days before "now" (not normalized to midnight) - subtracting UTC calendar days so it matches pace.ts's own UTC day math. */
export function daysAgo(n: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

/** The UTC calendar-day portion of a Date, as "YYYY-MM-DD" - matches pace.ts's own toISODate. */
export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export const yesterday = daysAgo(1);
export const tomorrow = isoDate(daysAgo(-1));

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

/** Upserts just the Level row (FK target for StudyPlan.levelId), with no topic/reading/LOS - unlike anyLosIdForLevel, so tests asserting exact LOS/topic counts for weighting don't get a stray extra LOS. */
export async function ensureLevel(levelId: "I" | "II" | "III" = "I"): Promise<void> {
  await db.level.upsert({ where: { id: levelId }, create: { id: levelId }, update: {} });
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

/**
 * Creates `count` fresh LOS rows, all under one new topic/reading (so a test
 * that only varies LOS count, not topic weighting, sees flat and
 * weighted coverage agree). Always inserts new rows, unlike
 * anyLosIdForLevel's reuse-if-present behavior, since callers pass an exact
 * count they need to exist.
 */
export async function anyLosIdsForLevel(
  levelId: "I" | "II" | "III" = "I",
  count: number,
): Promise<string[]> {
  await db.level.upsert({ where: { id: levelId }, create: { id: levelId }, update: {} });
  const topic = await db.topic.create({
    data: { levelId, name: "Test Topic", order: 1, examWeightMin: 1, examWeightMax: 1 },
  });
  const reading = await db.reading.create({
    data: { topicId: topic.id, name: "Test Reading", order: 1 },
  });
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const los = await db.lOS.create({
      data: { readingId: reading.id, text: `Test LOS ${i + 1}`, order: i + 1 },
    });
    ids.push(los.id);
  }
  return ids;
}

/**
 * Two topics under Level I, one LOS each, so Task 10's progress route can be
 * proven to weight coverage by topic exam weight rather than a flat LOS
 * count.
 */
export async function setupUserWithTwoTopics(opts: {
  lightWeight: number;
  heavyWeight: number;
}): Promise<{ user: RegisteredUser; plan: any; lightLosId: string; heavyLosId: string }> {
  const user = await registerUser();
  await db.level.upsert({ where: { id: "I" }, create: { id: "I" }, update: {} });

  const lightTopic = await db.topic.create({
    data: {
      levelId: "I",
      name: "Light Topic",
      order: 1,
      examWeightMin: opts.lightWeight,
      examWeightMax: opts.lightWeight,
    },
  });
  const lightReading = await db.reading.create({
    data: { topicId: lightTopic.id, name: "Light Reading", order: 1 },
  });
  const lightLos = await db.lOS.create({
    data: { readingId: lightReading.id, text: "Light LOS", order: 1 },
  });

  const heavyTopic = await db.topic.create({
    data: {
      levelId: "I",
      name: "Heavy Topic",
      order: 2,
      examWeightMin: opts.heavyWeight,
      examWeightMax: opts.heavyWeight,
    },
  });
  const heavyReading = await db.reading.create({
    data: { topicId: heavyTopic.id, name: "Heavy Reading", order: 1 },
  });
  const heavyLos = await db.lOS.create({
    data: { readingId: heavyReading.id, text: "Heavy LOS", order: 1 },
  });

  const plan = await createPlan(user, {
    levelId: "I",
    examDate: "2027-06-01",
    weeklyAvailability: fullWeek,
  });

  return { user, plan, lightLosId: lightLos.id, heavyLosId: heavyLos.id };
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

/**
 * Registers a user, ensures Level I curriculum exists, and creates a plan
 * for them in one step. Pass `totalLos` (Task 10) to get that many fresh LOS
 * rows (all in one topic, so flat and weighted coverage agree) instead of
 * reusing/creating the single default LOS; `secondLosId` is only set when
 * `totalLos` >= 2.
 */
export async function setupUserWithPlan(
  opts: Partial<{
    levelId: string;
    examDate: string;
    startDate: string;
    weeklyAvailability: typeof fullWeek;
    totalLos: number;
  }> = {},
): Promise<{ user: RegisteredUser; plan: any; losId: string; secondLosId?: string }> {
  const user = await registerUser();
  const levelId = (opts.levelId ?? "I") as "I" | "II" | "III";

  let losId: string;
  let secondLosId: string | undefined;
  if (opts.totalLos && opts.totalLos > 1) {
    const ids = await anyLosIdsForLevel(levelId, opts.totalLos);
    losId = ids[0]!;
    secondLosId = ids[1];
  } else {
    losId = await anyLosIdForLevel(levelId);
  }

  const plan = await createPlan(user, {
    levelId: opts.levelId ?? "I",
    examDate: opts.examDate ?? "2027-06-01",
    startDate: opts.startDate,
    weeklyAvailability: opts.weeklyAvailability ?? fullWeek,
  });
  return { user, plan, losId, secondLosId };
}

/** Returns an existing preset (userId: null) StudyPackage, creating one if the test DB has none yet. */
export async function anyPresetPackage(): Promise<any> {
  const existing = await db.studyPackage.findFirst({ where: { userId: null } });
  if (existing) return existing;
  return db.studyPackage.create({ data: { name: "UWorld", userId: null } });
}

/**
 * POSTs a log entry via the real route, returning the raw Response (callers
 * assert on status for validation-boundary tests). The route now supports
 * an explicit `date` directly (it used to only ever date a log `now()`, so
 * this fixture had to bypass the route and write backdated rows straight to
 * the DB for missedDays tests - that workaround is gone now that the real
 * route handles dates, so a dated log actually exercises the route's own
 * date-bounds validation instead of skipping it).
 */
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

/**
 * Seeds a small but realistically shaped curriculum: several topics with
 * different exam weights, each with readings, each with outcomes.
 *
 * Rows are inserted in deliberately scrambled `order` sequence so a route that
 * returns them in insertion or id order fails the ordering test instead of
 * passing by accident.
 */
export async function seedLevel(levelId: "I" | "II" | "III" = "I"): Promise<void> {
  await db.level.upsert({
    where: { id: levelId },
    create: { id: levelId, version: "2026-test" },
    update: { version: "2026-test" },
  });

  const topics = [
    { name: "Ethical and Professional Standards", order: 1, examWeightMin: 15, examWeightMax: 20 },
    { name: "Quantitative Methods", order: 2, examWeightMin: 8, examWeightMax: 12 },
    { name: "Financial Statement Analysis", order: 3, examWeightMin: 13, examWeightMax: 17 },
  ];

  // Reversed so insertion order is the opposite of curriculum order.
  for (const t of [...topics].reverse()) {
    const topic = await db.topic.create({ data: { levelId, ...t } });
    for (const rOrder of [2, 1]) {
      const reading = await db.reading.create({
        data: { topicId: topic.id, name: `${t.name} reading ${rOrder}`, order: rOrder },
      });
      for (const lOrder of [3, 1, 2]) {
        await db.lOS.create({
          data: {
            readingId: reading.id,
            text: `Describe outcome ${lOrder} of ${reading.name}`,
            order: lOrder,
          },
        });
      }
    }
  }
}

/**
 * A minimal provider catalogue bound to a seeded level, for tests in later
 * plans that need resources to schedule against.
 *
 * Deliberately small: one edition, one unit, one lecture, one reading binding.
 * A test that needs the real 88-unit catalogue is testing the loader, and that
 * belongs in tests/catalogue/seed-packages.test.ts instead.
 */
export async function seedCatalogue(opts: { levelId?: "I" | "II" | "III"; slug?: string } = {}): Promise<{
  packageId: string;
  editionId: string;
  unitId: string;
  resourceId: string;
}> {
  const levelId = opts.levelId ?? "II";
  const slug = opts.slug ?? "test-catalogue";
  await ensureLevel(levelId);

  const pkg = await db.studyPackage.upsert({
    where: { slug },
    create: { slug, name: "Test Catalogue", userId: null },
    update: {},
  });
  const edition = await db.packageEdition.upsert({
    where: { packageId_levelId_year: { packageId: pkg.id, levelId, year: "2026" } },
    create: { packageId: pkg.id, levelId, year: "2026" },
    update: {},
  });
  const unit = await db.packageUnit.upsert({
    where: { editionId_ref: { editionId: edition.id, ref: "tc/lm1" } },
    create: { editionId: edition.id, ref: "tc/lm1", order: 1, title: "Test Unit" },
    update: {},
  });
  const resource = await db.packageResource.upsert({
    where: { editionId_ref: { editionId: edition.id, ref: "tc/lm1/lecture/1" } },
    create: {
      editionId: edition.id,
      unitId: unit.id,
      ref: "tc/lm1/lecture/1",
      kind: "lecture",
      externalId: "1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      sizeKb: 1024,
    },
    update: {},
  });

  const reading = await db.reading.findFirst({ where: { topic: { levelId } } });
  if (reading) {
    await db.packageUnitReading.upsert({
      where: { unitId_readingId: { unitId: unit.id, readingId: reading.id } },
      create: { unitId: unit.id, readingId: reading.id },
      update: {},
    });
  }

  return { packageId: pkg.id, editionId: edition.id, unitId: unit.id, resourceId: resource.id };
}

/**
 * Sets up a complete plan with a seeded level and catalogue for schedule generation tests.
 * Seeds Level II with three topics, creates a plan, and links readings to catalogue resources.
 */
export async function setupPlanWithCatalogue(): Promise<{ planId: string }> {
  // Seed Level II with topics and readings (like in seedLevel)
  await db.level.upsert({
    where: { id: "II" },
    create: { id: "II", version: "2026-test" },
    update: { version: "2026-test" },
  });

  const topics = [
    { name: "Ethical and Professional Standards", order: 1, examWeightMin: 5, examWeightMax: 10 },
    { name: "Quantitative Methods", order: 2, examWeightMin: 20, examWeightMax: 25 },
    { name: "Financial Statement Analysis", order: 3, examWeightMin: 15, examWeightMax: 20 },
  ];

  const seedTopics = [];
  for (const t of topics) {
    const topic = await db.topic.create({ data: { levelId: "II", ...t } });
    seedTopics.push(topic);
    for (const rOrder of [1, 2]) {
      const reading = await db.reading.create({
        data: { topicId: topic.id, name: `${t.name} reading ${rOrder}`, order: rOrder },
      });
    }
  }

  // Create a catalogue with resources
  const pkg = await db.studyPackage.upsert({
    where: { slug: "test-schedule-catalogue" },
    create: { slug: "test-schedule-catalogue", name: "Test Schedule Catalogue", userId: null },
    update: {},
  });

  const edition = await db.packageEdition.upsert({
    where: { packageId_levelId_year: { packageId: pkg.id, levelId: "II", year: "2026" } },
    create: { packageId: pkg.id, levelId: "II", year: "2026" },
    update: {},
  });

  // Create units with resources for each topic's readings
  for (let i = 0; i < seedTopics.length; i++) {
    const topic = seedTopics[i];
    const readings = await db.reading.findMany({
      where: { topicId: topic.id },
      orderBy: { order: "asc" },
    });

    for (let j = 0; j < readings.length; j++) {
      const reading = readings[j];
      const unit = await db.packageUnit.create({
        data: {
          editionId: edition.id,
          ref: `topic${i + 1}/lm${j + 1}`,
          order: i * 10 + j + 1,
          title: `${topic.name} Unit ${j + 1}`,
        },
      });

      // Create a lecture resource with pageCount
      await db.packageResource.create({
        data: {
          editionId: edition.id,
          unitId: unit.id,
          ref: `topic${i + 1}/lm${j + 1}/lecture/1`,
          kind: "lecture",
          pageCount: 20,
          externalId: `lex${i}${j}`,
        },
      });

      // Link the unit to the reading
      await db.packageUnitReading.create({
        data: { unitId: unit.id, readingId: reading.id },
      });
    }
  }

  // Register a user and create a plan
  const user = await registerUser();

  const plan = await db.studyPlan.create({
    data: {
      userId: user.id,
      levelId: "II",
      examDate: new Date("2027-06-01"),
      startDate: new Date("2027-01-04"),
      weeklyAvailability: {
        mon: 120,
        tue: 120,
        wed: 120,
        thu: 120,
        fri: 120,
        sat: 60,
        sun: 60,
      },
      orderingStrategy: "curriculum",
    },
  });

  return { planId: plan.id };
}

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = join(HERE, "..", "..");

/** Reads DATABASE_URL straight out of .env.test, never out of process.env,
 * so the guard below cannot be fooled by something upstream having
 * mutated process.env.DATABASE_URL after setup ran. */
function testDatabaseUrl(): string {
  const envText = readFileSync(join(BACKEND_ROOT, ".env.test"), "utf8");
  const match = envText.match(/^DATABASE_URL="(.+)"$/m);
  if (!match) {
    throw new Error("DATABASE_URL not found in .env.test");
  }
  return match[1];
}

/**
 * Seeds the REAL curriculum and provider catalogue - the same private
 * `prisma/seed-data/*.json` files loaded into the dev database - into
 * whichever database DATABASE_URL currently points at.
 *
 * Refuses to run unless process.env.DATABASE_URL already matches
 * .env.test's value: resetDb() deletes every row in whatever database it's
 * pointed at, so a test that seeds real data must never run against
 * anything but the disposable test database (see prisma/cli-smoke.test.ts's
 * own caution about exactly this mistake with seed-packages.ts).
 *
 * seedPackages is called in-process (its main() is import-guarded, so this
 * is safe - tests/catalogue/seed-packages.test.ts does the same). The
 * curriculum seed script is spawned instead: its main() runs unconditionally
 * on import with no guard, so requiring it in-process would run it as an
 * unawaited side effect of the import itself.
 */
export async function seedRealCurriculumAndCatalogue(): Promise<void> {
  const databaseUrl = testDatabaseUrl();
  if (process.env.DATABASE_URL !== databaseUrl) {
    throw new Error(
      "Refusing to seed real curriculum/catalogue data: DATABASE_URL does not match .env.test's test database.",
    );
  }

  // Resolve tsx's own CLI entry and run it through plain `node`, rather than
  // the node_modules/.bin wrapper - that wrapper is a .CMD batch file on
  // Windows, which execFileSync cannot exec directly, and shelling out to
  // run it breaks on a path containing spaces (this repo's does).
  const require = createRequire(import.meta.url);
  const tsxCli = require.resolve("tsx/cli");
  execFileSync(process.execPath, [tsxCli, join(BACKEND_ROOT, "prisma", "seed.ts")], {
    cwd: BACKEND_ROOT,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "pipe",
  });

  await seedPackages();
}

/**
 * Sets up a plan against the REAL Level II curriculum and provider
 * catalogue (51 readings, 2 editions, ~230 resources) - not a synthetic
 * stand-in - for tests that need to prove the scheduler behaves correctly
 * against what the catalogue actually contains today, gaps included.
 */
export async function setupPlanWithRealCatalogue(): Promise<{ planId: string }> {
  await seedRealCurriculumAndCatalogue();

  const user = await registerUser();
  const plan = await db.studyPlan.create({
    data: {
      userId: user.id,
      levelId: "II",
      examDate: new Date("2027-06-01"),
      startDate: new Date("2027-01-04"),
      weeklyAvailability: {
        mon: 120,
        tue: 120,
        wed: 120,
        thu: 120,
        fri: 120,
        sat: 60,
        sun: 60,
      },
      orderingStrategy: "curriculum",
    },
  });

  return { planId: plan.id };
}
