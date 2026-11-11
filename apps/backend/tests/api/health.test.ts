import { afterEach, test, expect } from "vitest";
import { resetDb } from "../helpers/test-db";
import { anyLosIdForLevel, ensureLevel, setupPlanWithCatalogue } from "../helpers/fixtures";
import { GET } from "../../src/app/api/health/route";
import { readJson } from "../helpers/request";
import { checkConfig } from "../../src/lib/FUNC-config";

const SAVED = { ...process.env };

afterEach(() => {
  // Restore wholesale: these tests delete variables, and a leaked deletion
  // would fail an unrelated file in a way that looks like a real regression.
  process.env = { ...SAVED };
});

test("a correctly configured and seeded deployment reports healthy", async () => {
  // Seeded explicitly, because health now depends on it: a deploy applies
  // migrations and loads no data, so an empty curriculum is a real state the
  // endpoint has to distinguish rather than an artefact of the test database.
  await resetDb();
  await setupPlanWithCatalogue();

  const res = await GET();
  const body = await readJson(res);
  // The test environment sets everything the app needs, so anything reported
  // here is a real gap in .env.test rather than a test artefact.
  expect(body.configuration.errors).toEqual([]);
  expect(body.database).toBe(true);
  expect(body.seeded).toBe(true);
  expect(res.status).toBe(200);
});

test("a missing CRON_SECRET is an error, not a warning", async () => {
  // The quietest failure in the whole deployment: cron/tick returns 401 to
  // every call, so no snapshot is written and no coach email is ever sent, and
  // nothing logs anything, because 401 is the correct response to a caller
  // without the secret.
  delete process.env.CRON_SECRET;
  const res = await GET();

  expect(res.status).toBe(503);
  const body = await readJson(res);
  expect(body.configuration.errors.map((e: { variable: string }) => e.variable)).toContain(
    "CRON_SECRET",
  );
});

test("a missing FRONTEND_BASE_URL is an error", async () => {
  // Emails would be deliverable and completely dead inside.
  delete process.env.FRONTEND_BASE_URL;
  const report = checkConfig();
  expect(report.ok).toBe(false);
  expect(report.errors.map((e) => e.variable)).toContain("FRONTEND_BASE_URL");
});

test("an example domain is caught as well as an absent one", async () => {
  // A deploy that copied .env.example and changed only the database URL would
  // pass every presence check while mailing links to example.com.
  process.env.FRONTEND_BASE_URL = "https://app.example.com";
  const report = checkConfig();
  expect(report.ok).toBe(false);
  expect(
    report.errors.find((e) => e.variable === "FRONTEND_BASE_URL")?.detail,
  ).toMatch(/example domain/);
});

test("the published example JWT secret is an error, not a warning", async () => {
  // It signs sessions AND unsubscribe tokens, so a known value lets anyone turn
  // off anyone else's coaching.
  process.env.JWT_SECRET = "your-secret-key-here";
  const report = checkConfig();
  expect(report.ok).toBe(false);
  expect(report.errors.map((e) => e.variable)).toContain("JWT_SECRET");
});

test("a short but real JWT secret is a warning, not an error", async () => {
  process.env.JWT_SECRET = "short-but-mine";
  const report = checkConfig();
  expect(report.warnings.map((w) => w.variable)).toContain("JWT_SECRET");
  expect(report.errors.map((e) => e.variable)).not.toContain("JWT_SECRET");
});

test("incomplete SMTP degrades rather than breaks", async () => {
  // The app is useful without email. It is not useful while refusing traffic.
  delete process.env.SMTP_HOST;
  const report = checkConfig();
  expect(report.features.email).toBe(false);
  expect(report.errors.map((e) => e.variable)).not.toContain("SMTP_HOST");
  expect(report.warnings.some((w) => w.variable.includes("SMTP_HOST"))).toBe(true);
});

test("incomplete VAPID keys degrade rather than break", async () => {
  delete process.env.VAPID_PRIVATE_KEY;
  const report = checkConfig();
  expect(report.features.push).toBe(false);
  expect(report.ok).toBe(true);
});

test("a VAPID subject that is a bare address is an error", async () => {
  // By far the commonest VAPID mistake: web-push throws on a subject that is
  // not a mailto: or https: URL, which takes down every route importing it.
  process.env.VAPID_SUBJECT = "admin@mydomain.test";
  const report = checkConfig();
  expect(report.ok).toBe(false);
  expect(report.errors.map((e) => e.variable)).toContain("VAPID_SUBJECT");
});

test.each(["mailto:admin@mydomain.test", "https://mydomain.test/contact"])(
  "a VAPID subject of %s is accepted",
  async (subject) => {
    process.env.VAPID_SUBJECT = subject;
    const report = checkConfig();
    expect(report.errors.map((e) => e.variable)).not.toContain("VAPID_SUBJECT");
  },
);

test("the report never contains a secret value", async () => {
  // Unauthenticated endpoint. It may name variables and say whether each is
  // usable; it may never echo one back.
  process.env.JWT_SECRET = "a-real-looking-secret-value-of-sufficient-length";
  process.env.CRON_SECRET = "another-real-looking-secret";
  const raw = await (await GET()).text();

  expect(raw).not.toContain("a-real-looking-secret-value-of-sufficient-length");
  expect(raw).not.toContain("another-real-looking-secret");
  expect(raw).not.toContain(process.env.DATABASE_URL ?? "@@nope@@");
  if (process.env.SMTP_PASSWORD) {
    expect(raw).not.toContain(process.env.SMTP_PASSWORD);
  }
});

// SEED STATE
//
// A deploy applies migrations and does NOT seed: the curriculum and provider
// catalogue are licensed text, so prisma/seed-data/*.json is gitignored and
// therefore absent from the Docker image, and seed.ts skips quietly when it
// finds no files. Without this check a fresh deploy reports perfectly healthy
// while being unable to generate a single study task.

test("an unseeded database is not healthy", async () => {
  // resetDb has already emptied everything, so this is the exact state a fresh
  // deploy comes up in.
  await resetDb();
  const res = await GET();

  expect(res.status).toBe(503);
  const body = await readJson(res);
  expect(body.seeded).toBe(false);
  expect(body.curriculum.readings).toBe(0);
  // The distinction that matters to whoever is reading this at 2am: the
  // database is reachable and the configuration is fine. Only the data is
  // missing.
  expect(body.database).toBe(true);
  expect(body.configuration.ok).toBe(true);
});

test("a curriculum with no provider catalogue is NOT healthy", async () => {
  // Found in production rather than here, which is the whole point of writing
  // it down. The first deploy reported seeded: true holding 102 readings and
  // zero catalogue resources. The scheduler builds tasks from package
  // resources, so every plan came out empty while the flag that exists to catch
  // exactly this said everything was fine.
  await resetDb();
  await anyLosIdForLevel("II");

  const res = await GET();
  const body = await readJson(res);

  expect(body.curriculum.readings).toBeGreaterThan(0);
  expect(body.curriculum.catalogueResources).toBe(0);
  expect(body.seeded).toBe(false);
  expect(res.status).toBe(503);
});

test("a database with both seeds loaded is healthy", async () => {
  // The two seeds are separate scripts and the second is easy to forget, so
  // only the pair counts as seeded.
  await resetDb();
  await setupPlanWithCatalogue();

  const res = await GET();
  const body = await readJson(res);

  expect(body.curriculum.readings).toBeGreaterThan(0);
  expect(body.curriculum.catalogueResources).toBeGreaterThan(0);
  expect(body.seeded).toBe(true);
  expect(res.status).toBe(200);
});

test("a Level row with no readings still counts as unseeded", async () => {
  // A half-finished seed is worse than none, because it looks loaded. Probing
  // for the existence of a Level would pass here.
  await resetDb();
  await ensureLevel("II");
  const body = await readJson(await GET());

  expect(body.seeded).toBe(false);
  expect(body.curriculum.readings).toBe(0);
});
