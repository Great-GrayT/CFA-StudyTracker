# CFA Study Tracker Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and deploy the CFA Study Tracker's backend: a multi-user Next.js API (auth, curriculum tree, study plans, log entries, pace/coverage computation, import/export, cron-driven progress snapshots), self-hosted on the existing VPS behind Caddy, in the same shape as `cron-server`.

**Architecture:** A pnpm-workspace monorepo at the repo root with this plan's code under `apps/backend` (a Next.js 15 App Router project, API routes only, no pages). Prisma 6 + Postgres for persistence. Pure, framework-agnostic functions in `src/core/` do all pace/coverage/behind-ahead math so they're unit-testable without a database or HTTP layer, mirroring `cron-server`'s `core/` convention. Auth, rate limiting, and CORS mirror `cron-server`'s `src/lib/FUNC-auth.ts` / `middleware.ts` pattern exactly (JWT HS256 + `token_version` revocation, scrypt passwords, tiered rate limits, fail-closed CORS).

**Tech Stack:** Next.js 15, React 19 (unused here beyond the framework), TypeScript, Prisma 6 + Postgres, zod, pnpm, Vitest (new to this codebase: `cron-server` has no test runner, so none exists to mirror, Vitest is the pick, lightweight and fast against TS/Next route handlers).

**Spec:** [2026-11-04-cfa-study-tracker-design.md](../specs/2026-11-04-cfa-study-tracker-design.md)

## Global Constraints

- Public repo (`Great-GrayT/CFA-StudyTracker`). Never commit LOS bullet text; only topic/reading names are committable curriculum data.
- Auth: JWT HS256, `token_version` revocation, scrypt password hashes with `timingSafeEqual`, same as `cron-server`'s `FUNC-auth.ts`.
- `CORS_ALLOW_ORIGINS` fail-closed in production; comma-separated exact origins from env.
- Rate limits (tiered, per-IP sliding window): `/api/auth/login`, `/api/auth/oauth/*`: 10/min. `/api/auth/register`, `/api/auth/forgot-password`: 5/15min. Everything else: 240/min. (Values copied from `cron-server`'s `SECURITY.md`.)
- Confidence is an integer 1-5, enforced by zod at every route that accepts it; never clamped silently.
- Coverage counts a LOS once regardless of how many times it's logged in a day (spec, Plan/pace engine point 6).
- Deploy mirrors `cron-server`: multi-stage Dockerfile (`output: "standalone"` under `DOCKER_BUILD=1`), GitHub Actions build+push to GHCR then SSH pull+restart on push to `main`, Caddy reverse-proxy block, new Postgres role/db, new subdomain.
- No reminder notifications, no offline write queue, no quiz/question content: all out of scope per the spec's non-goals.

## Review Focus

- Confidence value outside 1-5 (0, 6, negative, non-integer) submitted to the log-entry endpoint: must reject with 400, never store or clamp.
- Registering an email that already exists: must return 409 with a clear message, never a generic 500 or a silent second account.
- A `StudyPlan`'s `examDate` already in the past (or today) when the pace engine computes remaining hours: must not divide by zero or go negative; target pace degrades to "no time left" rather than crashing.
- Logging the same LOS twice in one day: coverage counts it once; confidence and `questionsAnswered` still update from the latest entry (spec, Plan/pace engine point 6).
- A request from an `Origin` not in `CORS_ALLOW_ORIGINS`: rejected (no CORS headers / blocked), never allowed through because a check was skipped in dev.

---

## File Structure

```
pnpm-workspace.yaml                       # modify: add apps/*
apps/backend/
  package.json
  tsconfig.json
  next.config.js
  vitest.config.ts
  .env.example
  .gitignore                              # ignores prisma/seed-data/*.json
  Dockerfile                              # copied/adapted from cron-server
  .github/workflows/deploy.yml            # copied/adapted from cron-server
  prisma/
    schema.prisma
    seed.ts
    seed-data/.gitkeep
  src/
    lib/
      db.ts                               # Prisma client singleton
      FUNC-crypto.ts                      # scrypt hash/verify
      FUNC-auth.ts                        # JWT sign/verify, requireUser/requireFreshUser
      validation.ts                       # shared zod schemas
    middleware.ts                         # CORS + tiered rate limiting
    core/
      pace.ts                             # pure functions: coverage, target pace, study-next, behind/ahead
      pace.test.ts
    app/api/
      auth/
        register/route.ts
        login/route.ts
        me/route.ts
        oauth/[provider]/route.ts
        oauth/[provider]/callback/route.ts
      plans/
        route.ts                          # GET active plan, POST create (deactivates prior active)
        [id]/route.ts                     # PATCH weeklyAvailability/examDate
        import/route.ts                   # POST import a shared plan file
      packages/route.ts                   # GET presets+own, POST create custom
      logs/route.ts                       # POST create/update log entry, GET list (paginated)
      progress/route.ts                   # GET coverage, study-next list, behind/ahead
      export/
        all/route.ts                      # GET full JSON export
        log/route.ts                      # GET CSV of log entries
      cron/
        tick/route.ts                     # GET, Bearer CRON_SECRET, writes ProgressSnapshot rows
  tests/
    helpers/
      test-db.ts                          # per-test transaction/reset helper
      request.ts                          # builds a NextRequest + decodes a JSON Response
    api/
      auth.test.ts
      plans.test.ts
      logs.test.ts
      progress.test.ts
      export.test.ts
      cron-tick.test.ts
```

---

### Task 1: Workspace and backend project scaffold

**Files:**
- Modify: `pnpm-workspace.yaml`
- Create: `apps/backend/package.json`, `apps/backend/tsconfig.json`, `apps/backend/next.config.js`, `apps/backend/vitest.config.ts`, `apps/backend/.env.example`, `apps/backend/.gitignore`

**Interfaces:**
- Produces: a runnable `pnpm --filter backend dev` and `pnpm --filter backend test` from the repo root.

- [ ] **Step 1: Add `apps/*` to the workspace**

Edit `pnpm-workspace.yaml` at the repo root to include `apps/*` alongside any existing entries.

- [ ] **Step 2: Create `apps/backend/package.json`**

Scripts: `dev` (`next dev`), `build` (`prisma generate && next build`), `start` (`next start`), `typecheck` (`tsc --noEmit`), `test` (`vitest run`), `test:watch` (`vitest`), `postinstall` (`prisma generate`), `db:migrate` (`prisma migrate deploy`), `db:migrate:dev` (`prisma migrate dev`), `db:seed` (`tsx prisma/seed.ts`). Dependencies: `next@^15.1.3`, `react@^19.0.0`, `react-dom@^19.0.0`, `@prisma/client@^6.1.0`, `zod@^3.24.1`, `web-push@^3.6.7` (same library `openGym` uses for push). Dev dependencies: `prisma@^6.1.0`, `typescript@^5.7.2`, `@types/node`, `@types/react`, `@types/web-push`, `vitest`, `tsx`. `engines.node >= 20`, `packageManager: pnpm@11.9.0` (matches `cron-server`).

- [ ] **Step 3: Create `tsconfig.json`, `next.config.js`, `.gitignore`**

`next.config.js` enables `output: "standalone"` only when `process.env.DOCKER_BUILD === "1"`, same conditional as `cron-server`'s. `.gitignore` includes `prisma/seed-data/*.json` (keep `.gitkeep`), `.env`, `.next/`, `node_modules/`.

- [ ] **Step 4: Create `vitest.config.ts`**

Node environment, `tests/**/*.test.ts` and `src/**/*.test.ts` as test globs.

- [ ] **Step 5: Create `.env.example`**

Document every var this plan introduces (filled in later tasks): `DATABASE_URL`, `JWT_SECRET`, `JWT_TTL_HOURS`, `CRON_SECRET`, `CORS_ALLOW_ORIGINS`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `OAUTH_REDIRECT_BASE`, `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX_REQUESTS`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`.

- [ ] **Step 6: Install and verify**

Run: `pnpm install`
Expected: installs cleanly, `pnpm --filter backend typecheck` runs with no source files yet (passes trivially).

- [ ] **Step 7: Commit**

```bash
git add pnpm-workspace.yaml apps/backend
git commit -m "chore: scaffold backend workspace package"
```

---

### Task 2: Prisma schema and migration

**Files:**
- Create: `apps/backend/prisma/schema.prisma`

**Interfaces:**
- Produces: the `User`, `OAuthAccount`, `Level`, `Topic`, `Reading`, `LOS`, `StudyPackage`, `StudyPlan`, `StudyLogEntry`, `ProgressSnapshot`, `PushSubscription`, `PlanHoliday`, `MockExam`, `PlanPackage` Prisma models every later task imports via `@prisma/client`.

- [ ] **Step 1: Write `schema.prisma`**

```prisma
datasource db { provider = "postgresql"; url = env("DATABASE_URL") }
generator client { provider = "prisma-client-js" }

model User {
  id            String         @id @default(cuid())
  email         String         @unique
  passwordHash  String?
  tokenVersion  Int            @default(0)
  createdAt     DateTime       @default(now())
  oauthAccounts OAuthAccount[]
  plans         StudyPlan[]
  packages      StudyPackage[]
  logs          StudyLogEntry[]
  mockExams     MockExam[]
  pushSubscriptions PushSubscription[]
}

model OAuthAccount {
  id                String @id @default(cuid())
  userId            String
  provider          String
  providerAccountId String
  user              User   @relation(fields: [userId], references: [id])
  @@unique([provider, providerAccountId])
}

model Level {
  id     String  @id // "I" | "II" | "III"
  topics Topic[]
  plans  StudyPlan[]
}

model Topic {
  id            String    @id @default(cuid())
  levelId       String
  name          String
  order         Int
  examWeightMin Int
  examWeightMax Int
  level         Level     @relation(fields: [levelId], references: [id])
  readings      Reading[]
}

model Reading {
  id      String @id @default(cuid())
  topicId String
  name    String
  order   Int
  topic   Topic  @relation(fields: [topicId], references: [id])
  los     LOS[]
}

model LOS {
  id        String          @id @default(cuid())
  readingId String
  text      String
  order     Int
  reading   Reading         @relation(fields: [readingId], references: [id])
  logs      StudyLogEntry[]
}

model StudyPackage {
  id        String          @id @default(cuid())
  userId    String?
  name      String
  user      User?           @relation(fields: [userId], references: [id])
  logs      StudyLogEntry[]
  mockExams MockExam[]
  planPackages PlanPackage[]
}

model StudyPlan {
  id                 String             @id @default(cuid())
  userId             String
  levelId            String
  examDate           DateTime
  startDate          DateTime           @default(now())
  weeklyAvailability Json
  isActive           Boolean            @default(true)
  createdAt          DateTime           @default(now())
  user               User               @relation(fields: [userId], references: [id])
  level              Level              @relation(fields: [levelId], references: [id])
  logs               StudyLogEntry[]
  mockExams          MockExam[]
  snapshots          ProgressSnapshot[]
  holidays           PlanHoliday[]
  planPackages       PlanPackage[]
}

model StudyLogEntry {
  id                String        @id @default(cuid())
  userId            String
  planId            String
  losId             String
  packageId         String?
  date              DateTime      @default(now())
  confidence        Int
  questionsAnswered Int           @default(0)
  questionsCorrect  Int           @default(0)
  note              String?
  user              User          @relation(fields: [userId], references: [id])
  plan              StudyPlan     @relation(fields: [planId], references: [id])
  los               LOS           @relation(fields: [losId], references: [id])
  package           StudyPackage? @relation(fields: [packageId], references: [id])
  @@index([planId, losId])
}

model MockExam {
  id            String        @id @default(cuid())
  userId        String
  planId        String
  date          DateTime
  scorePercent  Int
  packageId     String?
  note          String?
  user          User          @relation(fields: [userId], references: [id])
  plan          StudyPlan     @relation(fields: [planId], references: [id])
  package       StudyPackage? @relation(fields: [packageId], references: [id])
}

model ProgressSnapshot {
  id               String   @id @default(cuid())
  planId           String
  date             DateTime
  targetCumulative Int
  actualCumulative Int
  plan             StudyPlan @relation(fields: [planId], references: [id])
  @@unique([planId, date])
}

model PushSubscription {
  id        String   @id @default(cuid())
  userId    String
  endpoint  String   @unique
  p256dh    String
  auth      String
  createdAt DateTime @default(now())
  user      User     @relation(fields: [userId], references: [id])
}

model PlanHoliday {
  id        String    @id @default(cuid())
  planId    String
  startDate DateTime
  endDate   DateTime
  note      String?
  plan      StudyPlan @relation(fields: [planId], references: [id])
}

model PlanPackage {
  id        String       @id @default(cuid())
  planId    String
  packageId String
  roles     String[]
  plan      StudyPlan    @relation(fields: [planId], references: [id])
  package   StudyPackage @relation(fields: [packageId], references: [id])
  @@unique([planId, packageId])
}
```

`weeklyAvailability` shape, fixed by this task for every later task to assume: `{"mon": number, "tue": number, "wed": number, "thu": number, "fri": number, "sat": number, "sun": number}`, hours per weekday.

- [ ] **Step 2: Generate the migration against a local dev Postgres**

Run: `pnpm --filter backend db:migrate:dev --name init`
Expected: migration file created under `prisma/migrations/`, applies cleanly to a local dev database.

- [ ] **Step 3: Commit**

```bash
git add apps/backend/prisma
git commit -m "feat: add backend Prisma schema and initial migration"
```

---

### Task 3: Curriculum seed script and private seed data

**Files:**
- Create: `apps/backend/prisma/seed.ts`, `apps/backend/prisma/seed-data/.gitkeep`
- Modify: `apps/backend/.gitignore` (already ignores `prisma/seed-data/*.json` from Task 1)

**Interfaces:**
- Consumes: `Level`, `Topic`, `Reading`, `LOS` models (Task 2).
- Produces: `pnpm --filter backend db:seed`, reading from `prisma/seed-data/level-{1,2,3}.json`.

- [ ] **Step 1: Define the seed JSON shape (documented in `seed.ts`'s top comment, not committed data)**

```ts
type SeedLevel = {
  id: "I" | "II" | "III"
  topics: Array<{
    name: string
    order: number
    examWeightMin: number
    examWeightMax: number
    readings: Array<{
      name: string
      order: number
      los: Array<{ text: string; order: number }>
    }>
  }>
}
```

- [ ] **Step 2: Implement `seed.ts`**

Reads every `prisma/seed-data/level-*.json` present, upserts `Level` by id, then upserts `Topic`/`Reading`/`LOS` by a composite natural key (`levelId`+`order` for topics, `topicId`+`order` for readings, `readingId`+`order` for LOS) so re-running the seed after a curriculum refresh updates text in place instead of duplicating rows. Logs a count of levels/topics/readings/LOS written. If no seed-data files are present, logs a warning and exits 0 (so `pnpm install` in CI never fails on missing private data).

- [ ] **Step 3: Write one real seed-data file from already-fetched content**

Create `apps/backend/prisma/seed-data/level-1.json` from the Level I topic/LOS text already fetched from CFA Institute's outline PDF earlier in this project, plus each topic's official exam-weight range (published by CFA Institute alongside the outline; fetch it if not already on hand). This file stays untracked (covered by `.gitignore`); it exists on disk for local/server use only.

- [ ] **Step 4: Verify against the local dev database**

Run: `pnpm --filter backend db:seed`
Expected: logs a non-zero count for Level I topics/readings/LOS, zero errors.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/prisma/seed.ts apps/backend/prisma/seed-data/.gitkeep
git commit -m "feat: add curriculum seed script (seed data stays untracked)"
```

---

### Task 4: Crypto and JWT auth core (`FUNC-crypto.ts`, `FUNC-auth.ts`)

**Files:**
- Create: `apps/backend/src/lib/FUNC-crypto.ts`, `apps/backend/src/lib/FUNC-auth.ts`
- Test: `apps/backend/src/lib/FUNC-crypto.test.ts`, `apps/backend/src/lib/FUNC-auth.test.ts`

**Interfaces:**
- Produces: `hashPassword(plain: string): Promise<string>`, `verifyPassword(plain: string, hash: string): Promise<boolean>` from `FUNC-crypto.ts`. `signJwt(payload: { userId: string; tokenVersion: number }): string`, `verifyJwt(token: string): { userId: string; tokenVersion: number } | null` from `FUNC-auth.ts`. Both consumed by every auth-protected route from Task 6 onward.

- [ ] **Step 1: Write the failing tests for `FUNC-crypto.ts`**

```ts
test("verifyPassword accepts the correct password", async () => {
  const hash = await hashPassword("correct-horse")
  expect(await verifyPassword("correct-horse", hash)).toBe(true)
})

test("verifyPassword rejects a wrong password", async () => {
  const hash = await hashPassword("correct-horse")
  expect(await verifyPassword("wrong", hash)).toBe(false)
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter backend test FUNC-crypto`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `FUNC-crypto.ts`**

`hashPassword`/`verifyPassword` using Node's `crypto.scrypt` with a random salt stored alongside the hash (`salt:hash` format) and `crypto.timingSafeEqual` for comparison, matching `cron-server`'s approach described in `SECURITY.md`.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter backend test FUNC-crypto`
Expected: PASS

- [ ] **Step 5: Write the failing tests for `FUNC-auth.ts`**

```ts
test("verifyJwt returns the payload for a token it signed", () => {
  const token = signJwt({ userId: "u1", tokenVersion: 0 })
  expect(verifyJwt(token)).toEqual({ userId: "u1", tokenVersion: 0 })
})

test("verifyJwt returns null for a tampered token", () => {
  const token = signJwt({ userId: "u1", tokenVersion: 0 })
  expect(verifyJwt(token + "x")).toBeNull()
})

test("verifyJwt returns null for an expired token", () => {
  const token = signJwt({ userId: "u1", tokenVersion: 0 }, { ttlSeconds: -1 })
  expect(verifyJwt(token)).toBeNull()
})
```

- [ ] **Step 6: Run to verify failure**

Run: `pnpm --filter backend test FUNC-auth`
Expected: FAIL, module not found.

- [ ] **Step 7: Implement `FUNC-auth.ts`**

HS256 via Node's `crypto.createHmac`, not a JWT library, so `verifyJwt` can ignore any `alg` field in the token and always recompute HS256 (immune to `alg:none`/confusion attacks, per `cron-server`'s `SECURITY.md`). `signJwt` takes an optional `{ ttlSeconds }` (default from `JWT_TTL_HOURS` env, default 72h) for the expiry test above.

- [ ] **Step 8: Run to verify pass**

Run: `pnpm --filter backend test FUNC-auth`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add apps/backend/src/lib/FUNC-crypto.ts apps/backend/src/lib/FUNC-crypto.test.ts apps/backend/src/lib/FUNC-auth.ts apps/backend/src/lib/FUNC-auth.test.ts
git commit -m "feat: add password hashing and JWT sign/verify"
```

---

### Task 5: Prisma client singleton and test-DB helper

**Files:**
- Create: `apps/backend/src/lib/db.ts`, `apps/backend/tests/helpers/test-db.ts`, `apps/backend/tests/helpers/request.ts`

**Interfaces:**
- Consumes: `PrismaClient` (Task 2's generated client).
- Produces: `db` (default export, a `PrismaClient` singleton) from `db.ts`, consumed by every route task. `resetDb(): Promise<void>` (deletes all rows, in FK-safe order) from `test-db.ts`, called in each API test file's `beforeEach`. `jsonRequest(method: string, url: string, body?: unknown, headers?: Record<string,string>): Request` and `readJson(res: Response): Promise<any>` from `request.ts`.

- [ ] **Step 1: Implement `db.ts`**

Standard Next.js-safe Prisma singleton (cache on `globalThis` in development to survive hot reload).

- [ ] **Step 2: Implement `test-db.ts`**

`resetDb` deletes in order: `ProgressSnapshot`, `StudyLogEntry`, `StudyPlan`, `StudyPackage`, `LOS`, `Reading`, `Topic`, `Level`, `OAuthAccount`, `User`. Requires `DATABASE_URL` to point at a disposable test database (documented in a comment; this plan does not stand up CI database infra, local Postgres is assumed for running these tests).

- [ ] **Step 3: Implement `request.ts`**

`jsonRequest` builds a `Request` with `Content-Type: application/json` and a JSON-stringified body; `readJson` calls `.json()` on a `Response`.

- [ ] **Step 4: Verify**

Run: `pnpm --filter backend typecheck`
Expected: PASS (no tests yet reference these; this task is pure plumbing other tasks' tests import).

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/lib/db.ts apps/backend/tests/helpers
git commit -m "chore: add Prisma client singleton and API test helpers"
```

---

### Task 6: Register, login, me routes

**Files:**
- Create: `apps/backend/src/lib/validation.ts`, `apps/backend/src/app/api/auth/register/route.ts`, `apps/backend/src/app/api/auth/login/route.ts`, `apps/backend/src/app/api/auth/me/route.ts`
- Test: `apps/backend/tests/api/auth.test.ts`

**Interfaces:**
- Consumes: `hashPassword`, `verifyPassword` (Task 4), `signJwt`, `verifyJwt` (Task 4), `db` (Task 5).
- Produces: `registerSchema`, `loginSchema` (zod, exported from `validation.ts`) for later tasks' routes to follow the same pattern. `requireUser(req: Request): Promise<{ userId: string } | null>` exported from `FUNC-auth.ts` (extend Task 4's file), used by every protected route from here on: reads the `Authorization: Bearer <token>` header, verifies the JWT, re-checks `tokenVersion` against the DB row, returns `null` on any failure.

- [ ] **Step 1: Write the failing tests**

```ts
beforeEach(resetDb)

test("register creates a user and returns a token", async () => {
  const res = await POST(jsonRequest("POST", "/api/auth/register", { email: "a@b.com", password: "correct-horse-battery" }))
  expect(res.status).toBe(201)
  const body = await readJson(res)
  expect(body.token).toBeTypeOf("string")
})

test("register rejects a duplicate email with 409", async () => {
  await POST(jsonRequest("POST", "/api/auth/register", { email: "a@b.com", password: "correct-horse-battery" }))
  const res = await POST(jsonRequest("POST", "/api/auth/register", { email: "a@b.com", password: "another-password" }))
  expect(res.status).toBe(409)
})

test("login succeeds with the right password and fails with the wrong one", async () => {
  await POST(jsonRequest("POST", "/api/auth/register", { email: "a@b.com", password: "correct-horse-battery" }))
  const ok = await LOGIN(jsonRequest("POST", "/api/auth/login", { email: "a@b.com", password: "correct-horse-battery" }))
  expect(ok.status).toBe(200)
  const bad = await LOGIN(jsonRequest("POST", "/api/auth/login", { email: "a@b.com", password: "wrong" }))
  expect(bad.status).toBe(401)
})

test("me returns 401 with no token and 200 with a valid one", async () => {
  const reg = await readJson(await POST(jsonRequest("POST", "/api/auth/register", { email: "a@b.com", password: "correct-horse-battery" })))
  const unauthed = await ME(jsonRequest("GET", "/api/auth/me"))
  expect(unauthed.status).toBe(401)
  const authed = await ME(jsonRequest("GET", "/api/auth/me", undefined, { Authorization: `Bearer ${reg.token}` }))
  expect(authed.status).toBe(200)
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter backend test auth`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement `validation.ts`**

`registerSchema = z.object({ email: z.string().email(), password: z.string().min(8) })`, `loginSchema` same shape.

- [ ] **Step 4: Implement the three routes and `requireUser`**

`register/route.ts`: `POST`, validates body, 409 if email exists, else creates the user with `hashPassword`, returns `201` with `{ token: signJwt(...) }`. `login/route.ts`: `POST`, 401 on any mismatch (wrong email or password, same message for both, no user enumeration), else `200` with `{ token }`. `me/route.ts`: `GET`, uses `requireUser`, `401` if null, else `200` with `{ id, email, createdAt }`. `requireUser` added to `FUNC-auth.ts`.

- [ ] **Step 5: Run to verify pass**

Run: `pnpm --filter backend test auth`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/lib/validation.ts apps/backend/src/lib/FUNC-auth.ts apps/backend/src/app/api/auth apps/backend/tests/api/auth.test.ts
git commit -m "feat: add register, login, me auth routes"
```

---

### Task 7: CORS and rate-limit middleware

**Files:**
- Create: `apps/backend/src/middleware.ts`
- Test: `apps/backend/src/middleware.test.ts`

**Interfaces:**
- Consumes: `CORS_ALLOW_ORIGINS`, `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX_REQUESTS` env vars.
- Produces: the Next.js `middleware` export every request passes through; no other task calls this directly.

- [ ] **Step 1: Write the failing tests**

```ts
test("rejects a request from an origin not in CORS_ALLOW_ORIGINS", () => {
  const res = middleware(requestWithOrigin("https://evil.example.com"))
  expect(res.status).toBe(403)
})

test("allows a request from an origin in CORS_ALLOW_ORIGINS", () => {
  const res = middleware(requestWithOrigin(process.env.CORS_ALLOW_ORIGINS!.split(",")[0]))
  expect(res.status).not.toBe(403)
})

test("blocks the login tier after its budget is exceeded", () => {
  const ip = "1.2.3.4"
  for (let i = 0; i < 10; i++) expect(middleware(loginRequestFrom(ip)).status).not.toBe(429)
  expect(middleware(loginRequestFrom(ip)).status).toBe(429)
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter backend test middleware`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `middleware.ts`**

Fail-closed CORS (reject, don't just omit headers, when `Origin` is present and not in the allow-list). In-memory sliding-window rate limiter (a `Map`, matching `cron-server`'s current implementation and its documented Redis follow-up) keyed by client IP + tier, using this plan's Global Constraints budgets. `config.matcher` set to `/api/:path*`.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter backend test middleware`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/middleware.ts apps/backend/src/middleware.test.ts
git commit -m "feat: add CORS and tiered rate-limit middleware"
```

---

### Task 8: Pace engine core (`src/core/pace.ts`)

**Files:**
- Create: `apps/backend/src/core/pace.ts`
- Test: `apps/backend/src/core/pace.test.ts`

**Interfaces:**
- Consumes: nothing (pure functions, no DB, no framework).
- Produces, all consumed by Task 10 (`progress/route.ts`) and Task 12 (`cron/tick/route.ts`):
  - `remainingHours(weeklyAvailability: WeeklyAvailability, from: Date, examDate: Date, holidays: DateRange[]): number` (a day inside any holiday range counts as 0 hours regardless of its weekday)
  - `targetDailyPace(totalLosCount: number, remainingLosCount: number, remainingHours: number): number` (LOS-per-hour; returns `0` when `remainingHours <= 0`, never divides by zero or goes negative)
  - `studyNextList(losList: LosWithStatus[]): LosWithStatus[]` (flagged-for-review first, oldest-rated first, then not-yet-studied in curriculum order, spec's Confidence and review section)
  - `coverageCount(logs: { losId: string }[]): number` (distinct `losId` count, the "count once per LOS" rule from spec point 6)
  - `behindAhead(actualCumulative: number, targetCumulative: number): { delta: number; percent: number }`
  - `missedStudyDays(weeklyAvailability: WeeklyAvailability, loggedDates: Date[], { from, to }: { from: Date; to: Date }, holidays: DateRange[]): string[]` (ISO date strings, inclusive range, where that weekday's planned hours > 0, the day isn't inside any holiday range, and no logged date falls on it)
  - `classifyLosFlag(input: { confidence: number; questionsAnswered: number; questionsCorrect: number; lastTouchedAt: Date }, now: Date): boolean` (true if confidence <= 2, or accuracy < 0.6 with questionsAnswered >= 3, or `now - lastTouchedAt` > 30 days, spec's Confidence and review section, three independent threshold checks)
  - `weightedCoveragePercent(items: Array<{ covered: boolean; weightShare: number }>): number` (0-100; `weightShare` is each LOS's pre-divided slice of its topic's exam weight, supplied by the caller, see Task 10)
  - `splitProgress(logs: Array<{ isFirstEverLog: boolean }>): { newCoverage: number; reviewWork: number }` (partitions a period's logs into first-time coverage vs review-of-already-covered, spec point 3)
  - `isPaceRealistic(requiredDailyHours: number, ceilingHoursPerDay?: number): boolean` (defaults `ceilingHoursPerDay` to the exported constant `DEFAULT_PACE_CEILING_HOURS = 6`)
  - `shouldNudgeDiversity(questionsByPackageId: Record<string, number>, confidence: number): boolean` (true when the values sum to >= 20, exactly one key has a non-zero value, and `confidence < 4`; `questionsByPackageId` is pre-filtered by the caller to `questions`-role packages only)
  - `recommendedSessionSplit(remainingWeeklyHours: number, contentRatio?: number): { contentHours: number; practiceHours: number }` (defaults `contentRatio` to the exported constant `DEFAULT_CONTENT_RATIO = 1/3`; `contentHours = remainingWeeklyHours * contentRatio`, `practiceHours` is the rest)

  `DateRange = { start: Date; end: Date }` (inclusive), the shape `PlanHoliday` rows become when passed into this module.

- [ ] **Step 1: Write the failing tests**

```ts
test("remainingHours is 0, not negative, when examDate is in the past", () => {
  expect(remainingHours(availability, today, pastDate, [])).toBe(0)
})

test("remainingHours excludes a day that falls inside a holiday range", () => {
  const withoutHoliday = remainingHours(availability, monday, nextMonday, [])
  const withHoliday = remainingHours(availability, monday, nextMonday, [{ start: wednesday, end: wednesday }])
  expect(withHoliday).toBe(withoutHoliday - availability.wed)
})

test("targetDailyPace is 0 when no hours remain, not Infinity or NaN", () => {
  expect(targetDailyPace(100, 100, 0)).toBe(0)
})

test("coverageCount counts a LOS once no matter how many times it's logged", () => {
  expect(coverageCount([{ losId: "a" }, { losId: "a" }, { losId: "b" }])).toBe(2)
})

test("studyNextList puts flagged-for-review LOS before not-yet-studied ones, oldest rating first", () => {
  const result = studyNextList([
    { losId: "a", status: "not-started", order: 1 },
    { losId: "b", status: "flagged", lastRatedAt: new Date("2026-01-02"), order: 2 },
    { losId: "c", status: "flagged", lastRatedAt: new Date("2026-01-01"), order: 3 },
  ])
  expect(result.map(r => r.losId)).toEqual(["c", "b", "a"])
})

test("behindAhead reports a negative delta when actual trails target", () => {
  expect(behindAhead(5, 10)).toEqual({ delta: -5, percent: 50 })
})

test("missedStudyDays flags a planned weekday with no logged date, and skips a 0-hour day", () => {
  const monday = new Date("2026-11-02")   // planned 2h, nothing logged
  const tuesday = new Date("2026-11-03")  // planned 0h, nothing logged, not a miss
  const result = missedStudyDays(availability, [], { from: monday, to: tuesday }, [])
  expect(result).toEqual(["2026-11-02"])
})

test("missedStudyDays does not flag a planned day that has a log on it", () => {
  const monday = new Date("2026-11-02")
  const result = missedStudyDays(availability, [monday], { from: monday, to: monday }, [])
  expect(result).toEqual([])
})

test("classifyLosFlag flags low confidence regardless of accuracy", () => {
  expect(classifyLosFlag({ confidence: 2, questionsAnswered: 10, questionsCorrect: 10, lastTouchedAt: today }, today)).toBe(true)
})

test("classifyLosFlag flags poor accuracy once enough questions have been answered", () => {
  expect(classifyLosFlag({ confidence: 5, questionsAnswered: 5, questionsCorrect: 1, lastTouchedAt: today }, today)).toBe(true)
})

test("classifyLosFlag does not flag poor accuracy below the minimum question count", () => {
  expect(classifyLosFlag({ confidence: 5, questionsAnswered: 2, questionsCorrect: 0, lastTouchedAt: today }, today)).toBe(false)
})

test("classifyLosFlag flags a stale LOS even with a high confidence and good accuracy", () => {
  const thirtyFiveDaysAgo = new Date(today.getTime() - 35 * 24 * 60 * 60 * 1000)
  expect(classifyLosFlag({ confidence: 5, questionsAnswered: 10, questionsCorrect: 10, lastTouchedAt: thirtyFiveDaysAgo }, today)).toBe(true)
})

test("classifyLosFlag does not flag a LOS with high confidence, good accuracy, and a recent touch", () => {
  expect(classifyLosFlag({ confidence: 5, questionsAnswered: 10, questionsCorrect: 10, lastTouchedAt: today }, today)).toBe(false)
})

test("weightedCoveragePercent weights by each item's weightShare, not a flat count", () => {
  const result = weightedCoveragePercent([
    { covered: true, weightShare: 20 },
    { covered: false, weightShare: 80 },
  ])
  expect(result).toBe(20)
})

test("splitProgress partitions first-time coverage from review work", () => {
  expect(splitProgress([{ isFirstEverLog: true }, { isFirstEverLog: true }, { isFirstEverLog: false }]))
    .toEqual({ newCoverage: 2, reviewWork: 1 })
})

test("isPaceRealistic is false once required daily hours exceed the ceiling", () => {
  expect(isPaceRealistic(7, 6)).toBe(false)
  expect(isPaceRealistic(5, 6)).toBe(true)
})

test("isPaceRealistic defaults its ceiling to DEFAULT_PACE_CEILING_HOURS", () => {
  expect(isPaceRealistic(DEFAULT_PACE_CEILING_HOURS + 1)).toBe(false)
})

test("shouldNudgeDiversity is true for 20+ questions from a single package at mid confidence", () => {
  expect(shouldNudgeDiversity({ uworld: 25 }, 3)).toBe(true)
})

test("shouldNudgeDiversity is false once a second package contributes questions", () => {
  expect(shouldNudgeDiversity({ uworld: 15, kaplan: 10 }, 3)).toBe(false)
})

test("shouldNudgeDiversity is false once confidence is high regardless of source count", () => {
  expect(shouldNudgeDiversity({ uworld: 25 }, 4)).toBe(false)
})

test("recommendedSessionSplit applies a 1:2 content-to-practice ratio by default", () => {
  expect(recommendedSessionSplit(9)).toEqual({ contentHours: 3, practiceHours: 6 })
})

test("recommendedSessionSplit honors a custom ratio", () => {
  expect(recommendedSessionSplit(10, 0.5)).toEqual({ contentHours: 5, practiceHours: 5 })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter backend test pace`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `pace.ts`**

`WeeklyAvailability = { mon: number; tue: number; wed: number; thu: number; fri: number; sat: number; sun: number }`. `LosWithStatus = { losId: string; status: "not-started" | "covered" | "flagged"; lastRatedAt?: Date; order: number }` (Task 10 is responsible for turning a LOS's confidence/accuracy/last-touched data into this `status`, calling `classifyLosFlag` to decide "covered" vs "flagged"). Export `DEFAULT_PACE_CEILING_HOURS = 6` and `DEFAULT_CONTENT_RATIO = 1/3` as named constants.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter backend test pace`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/core/pace.ts apps/backend/src/core/pace.test.ts
git commit -m "feat: add pure pace/coverage/behind-ahead engine"
```

---

### Task 9: Plans, packages, logs routes

**Files:**
- Create: `apps/backend/src/app/api/plans/route.ts`, `apps/backend/src/app/api/plans/[id]/route.ts`, `apps/backend/src/app/api/plans/[id]/holidays/route.ts`, `apps/backend/src/app/api/plans/[id]/holidays/[holidayId]/route.ts`, `apps/backend/src/app/api/plans/[id]/packages/route.ts`, `apps/backend/src/app/api/plans/[id]/packages/[packageId]/route.ts`, `apps/backend/src/app/api/packages/route.ts`, `apps/backend/src/app/api/logs/route.ts`
- Test: `apps/backend/tests/api/plans.test.ts`, `apps/backend/tests/api/logs.test.ts`

**Interfaces:**
- Consumes: `requireUser` (Task 6), `db` (Task 5).
- Produces: nothing further consumed outside Task 10's reads of the same tables.

- [ ] **Step 1: Write the failing tests**

```ts
test("creating a new active plan deactivates the previous active plan", async () => {
  const user = await registerUser()
  await createPlan(user, { levelId: "I", examDate: "2027-06-01", weeklyAvailability: fullWeek })
  const second = await createPlan(user, { levelId: "I", examDate: "2027-12-01", weeklyAvailability: fullWeek })
  const plans = await listPlansForUser(user)
  expect(plans.filter(p => p.isActive)).toEqual([expect.objectContaining({ id: second.id })])
})

test("creating a plan with backfilled logs writes one StudyLogEntry per entry, dated startDate", async () => {
  const user = await registerUser()
  const losId = await anyLosIdForLevel("I")
  const plan = await createPlan(user, {
    levelId: "I", examDate: "2027-06-01", startDate: "2026-10-01", weeklyAvailability: fullWeek,
    initialLogs: [{ losId, confidence: 4, questionsAnswered: 12 }],
  })
  const logs = await listLogs(user, plan.id)
  expect(logs).toEqual([expect.objectContaining({ losId, confidence: 4, questionsAnswered: 12, date: new Date("2026-10-01") })])
})

test("adding a holiday range excludes it from the plan's remaining hours", async () => {
  const { user, plan } = await setupUserWithPlan({ weeklyAvailability: fullWeek })
  const before = await getProgress(user, plan.id)
  const res = await POST(authedRequest(user, `/api/plans/${plan.id}/holidays`, { startDate: "2026-12-20", endDate: "2026-12-27", note: "trip" }))
  expect(res.status).toBe(201)
  const after = await getProgress(user, plan.id)
  expect(after.today.targetCumulative).toBeLessThanOrEqual(before.today.targetCumulative)
})

test("deleting a holiday range removes it", async () => {
  const { user, plan } = await setupUserWithPlan()
  const holiday = await readJson(await POST(authedRequest(user, `/api/plans/${plan.id}/holidays`, { startDate: "2026-12-20", endDate: "2026-12-27" })))
  const res = await DELETE(authedRequest(user, `/api/plans/${plan.id}/holidays/${holiday.id}`))
  expect(res.status).toBe(200)
  expect(await db.planHoliday.count()).toBe(0)
})

test("tagging a package with roles on a plan, then re-tagging it, replaces the roles rather than duplicating the row", async () => {
  const { user, plan } = await setupUserWithPlan()
  const pkg = await anyPresetPackage()
  await POST(authedRequest(user, `/api/plans/${plan.id}/packages`, { packageId: pkg.id, roles: ["content"] }))
  await POST(authedRequest(user, `/api/plans/${plan.id}/packages`, { packageId: pkg.id, roles: ["content", "questions"] }))
  const list = await readJson(await GET(authedRequest(user, `/api/plans/${plan.id}/packages`)))
  expect(list).toEqual([expect.objectContaining({ packageId: pkg.id, roles: ["content", "questions"] })])
})

test("logging a confidence outside 1-5 is rejected with 400", async () => {
  const { user, plan, losId } = await setupUserWithPlan()
  const res = await createLog(user, { planId: plan.id, losId, confidence: 6, questionsAnswered: 0 })
  expect(res.status).toBe(400)
})

test("logging more questionsCorrect than questionsAnswered is rejected with 400", async () => {
  const { user, plan, losId } = await setupUserWithPlan()
  const res = await createLog(user, { planId: plan.id, losId, confidence: 3, questionsAnswered: 2, questionsCorrect: 5 })
  expect(res.status).toBe(400)
})

test("logging the same LOS twice in one day updates confidence but is one coverage entry", async () => {
  const { user, plan, losId } = await setupUserWithPlan()
  await createLog(user, { planId: plan.id, losId, confidence: 2, questionsAnswered: 3 })
  await createLog(user, { planId: plan.id, losId, confidence: 4, questionsAnswered: 2 })
  const logs = await listLogs(user, plan.id)
  expect(logs.filter(l => l.losId === losId)).toHaveLength(2)
  // coverage-once behavior is asserted on the progress endpoint in Task 10, not here
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter backend test "plans|logs"`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement the routes**

`plans/route.ts`: `GET` returns the caller's active plan (404 if none); `POST` (zod: `levelId`, `examDate`, `startDate` optional (defaults to now), `weeklyAvailability`, `initialLogs` optional array of `{ losId, confidence: 1-5, questionsAnswered }` for mid-stream onboarding) sets any existing active plan's `isActive` to `false`, creates the new plan, and creates one `StudyLogEntry` per `initialLogs` entry dated `startDate`, all in the same transaction. `plans/[id]/route.ts`: `PATCH` (zod: optional `examDate`, `weeklyAvailability`), 403 if the plan isn't the caller's. `plans/[id]/holidays/route.ts`: `POST` (zod: `startDate`, `endDate`, optional `note`) creates a `PlanHoliday` on the caller's plan, 403 otherwise; `GET` lists them. `plans/[id]/holidays/[holidayId]/route.ts`: `DELETE` removes one, 403 if it isn't on the caller's plan, `200` even if already absent (idempotent). `plans/[id]/packages/route.ts`: `POST` (zod: `packageId`, `roles` as `z.array(z.enum(["content", "questions", "mocks"])).min(1)`) upserts a `PlanPackage` on the caller's plan (unique on `[planId, packageId]`, so re-POSTing the same package replaces its roles), 403 otherwise; `GET` lists the plan's `PlanPackage` rows joined with their `StudyPackage` name. `plans/[id]/packages/[packageId]/route.ts`: `DELETE` removes one, 403 if not the caller's. `packages/route.ts`: `GET` returns presets (`userId: null`) plus the caller's own; `POST` (zod: `name`) creates one scoped to the caller. `logs/route.ts`: `POST` (zod: `planId`, `losId`, `confidence` as `z.number().int().min(1).max(5)`, `questionsAnswered` as `z.number().int().min(0)`, `questionsCorrect` as `z.number().int().min(0)` optional defaulting to 0, refined so `questionsCorrect <= questionsAnswered` (400 otherwise), optional `packageId`, `note`) creates a log entry, 403 if `planId` isn't the caller's active-or-owned plan; `GET` lists the caller's logs for a given `planId` (query param), paginated (`?cursor=`, `?limit=`, default 50).

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter backend test "plans|logs"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/app/api/plans apps/backend/src/app/api/packages apps/backend/src/app/api/logs apps/backend/tests/api/plans.test.ts apps/backend/tests/api/logs.test.ts
git commit -m "feat: add plans, packages, and log-entry routes"
```

---

### Task 10: Progress route (coverage, study-next, behind/ahead)

**Files:**
- Create: `apps/backend/src/app/api/progress/route.ts`
- Test: `apps/backend/tests/api/progress.test.ts`

**Interfaces:**
- Consumes: `requireUser` (Task 6), `db` (Task 5), `coverageCount`, `weightedCoveragePercent`, `studyNextList`, `classifyLosFlag`, `targetDailyPace`, `remainingHours`, `behindAhead`, `missedStudyDays`, `splitProgress`, `isPaceRealistic`, `shouldNudgeDiversity`, `recommendedSessionSplit` (Task 8), `ProgressSnapshot` rows (Task 2), `PlanPackage` rows (Task 2, to find which packages are `questions`-role for this plan).
- Produces: the `GET /api/progress?planId=` response shape `{ coveragePercent: number; studyNext: LosWithStatus[]; today: { targetCumulative, newCoverage, reviewWork, actualCumulative, delta, percent }; paceRealistic: boolean; diversityNudges: string[]; recommendedSplit: { contentHours: number; practiceHours: number }; history: ProgressSnapshot[]; missedDays: string[] }` (`missedDays` covers the trailing 7 days; `coveragePercent` is topic-exam-weighted, not a flat LOS count; `diversityNudges` is the list of `losId`s `shouldNudgeDiversity` returned true for; `recommendedSplit` is computed from the plan's remaining weekly hours) consumed by Task 11's export and by the (separate) frontend plan.

- [ ] **Step 1: Write the failing tests**

```ts
test("logging the same LOS twice counts as one covered LOS in the coverage percentage", async () => {
  const { user, plan, losId } = await setupUserWithPlan({ totalLos: 2 }) // both LOS in one topic, so flat and weighted agree here
  await createLog(user, { planId: plan.id, losId, confidence: 2, questionsAnswered: 0 })
  await createLog(user, { planId: plan.id, losId, confidence: 4, questionsAnswered: 0 })
  const res = await GET(authedRequest(user, `/api/progress?planId=${plan.id}`))
  const body = await readJson(res)
  expect(body.coveragePercent).toBe(50)
})

test("coverage is weighted by topic exam weight, not a flat LOS count", async () => {
  // two topics: one weighted 10, one weighted 90, one LOS each; covering only the heavy topic's LOS
  const { user, plan, heavyLosId } = await setupUserWithTwoTopics({ lightWeight: 10, heavyWeight: 90 })
  await createLog(user, { planId: plan.id, losId: heavyLosId, confidence: 4, questionsAnswered: 0 })
  const res = await GET(authedRequest(user, `/api/progress?planId=${plan.id}`))
  const body = await readJson(res)
  expect(body.coveragePercent).toBe(90) // not 50, which a flat count would give
})

test("a LOS with low question-bank accuracy is flagged for review even at high confidence", async () => {
  const { user, plan, losId } = await setupUserWithPlan()
  await createLog(user, { planId: plan.id, losId, confidence: 5, questionsAnswered: 5, questionsCorrect: 1 })
  const res = await GET(authedRequest(user, `/api/progress?planId=${plan.id}`))
  const body = await readJson(res)
  expect(body.studyNext[0]).toEqual(expect.objectContaining({ losId, status: "flagged" }))
})

test("today's actual progress splits into newCoverage and reviewWork", async () => {
  const { user, plan, losId: losA, secondLosId: losB } = await setupUserWithPlan({ totalLos: 2 })
  await createLog(user, { planId: plan.id, losId: losA, confidence: 2, questionsAnswered: 0 }) // first-ever: new coverage
  await createLog(user, { planId: plan.id, losId: losA, confidence: 2, questionsAnswered: 0 }) // re-study of a flagged LOS: review work
  const res = await GET(authedRequest(user, `/api/progress?planId=${plan.id}`))
  const body = await readJson(res)
  expect(body.today.newCoverage).toBe(1)
  expect(body.today.reviewWork).toBe(1)
})

test("paceRealistic is false when the remaining LOS can't plausibly fit in the remaining time", async () => {
  const { user, plan } = await setupUserWithPlan({ examDate: tomorrow, weeklyAvailability: minimalWeek })
  const res = await GET(authedRequest(user, `/api/progress?planId=${plan.id}`))
  expect((await readJson(res)).paceRealistic).toBe(false)
})

test("diversityNudges includes a LOS drilled 20+ times from one questions-role package at mid confidence", async () => {
  const { user, plan, losId } = await setupUserWithPlan()
  const pkg = await anyPresetPackage() // e.g. UWorld
  await POST(authedRequest(user, `/api/plans/${plan.id}/packages`, { packageId: pkg.id, roles: ["questions"] }))
  await createLog(user, { planId: plan.id, losId, packageId: pkg.id, confidence: 3, questionsAnswered: 25, questionsCorrect: 20 })
  const res = await GET(authedRequest(user, `/api/progress?planId=${plan.id}`))
  expect((await readJson(res)).diversityNudges).toContain(losId)
})

test("recommendedSplit reflects the plan's remaining weekly hours at the default 1:2 ratio", async () => {
  const { user, plan } = await setupUserWithPlan({ weeklyAvailability: nineHoursPerWeek })
  const res = await GET(authedRequest(user, `/api/progress?planId=${plan.id}`))
  const body = await readJson(res)
  expect(body.recommendedSplit).toEqual({ contentHours: 3, practiceHours: 6 })
})

test("a plan with an exam date in the past returns today's target as 0, not an error", async () => {
  const { user, plan } = await setupUserWithPlan({ examDate: "2020-01-01" })
  const res = await GET(authedRequest(user, `/api/progress?planId=${plan.id}`))
  expect(res.status).toBe(200)
  expect((await readJson(res)).today.targetCumulative).toBe(0)
})

test("today's view is live; a past day's view reads the stored ProgressSnapshot", async () => {
  const { user, plan } = await setupUserWithPlan()
  await db.progressSnapshot.create({ data: { planId: plan.id, date: yesterday, targetCumulative: 3, actualCumulative: 1 } })
  const res = await GET(authedRequest(user, `/api/progress?planId=${plan.id}`))
  const body = await readJson(res)
  expect(body.history).toContainEqual(expect.objectContaining({ targetCumulative: 3, actualCumulative: 1 }))
})

test("missedDays is empty when every planned day in the trailing week has a log", async () => {
  const { user, plan, losId } = await setupUserWithPlan({ weeklyAvailability: fullWeek })
  for (let i = 0; i < 7; i++) {
    await createLog(user, { planId: plan.id, losId, confidence: 3, questionsAnswered: 0, date: daysAgo(i) })
  }
  const res = await GET(authedRequest(user, `/api/progress?planId=${plan.id}`))
  expect((await readJson(res)).missedDays).toEqual([])
})

test("missedDays includes a planned day in the trailing week that has no log", async () => {
  const { user, plan, losId } = await setupUserWithPlan({ weeklyAvailability: fullWeek })
  // log every day except three days ago
  for (let i = 0; i < 7; i++) {
    if (i === 3) continue
    await createLog(user, { planId: plan.id, losId, confidence: 3, questionsAnswered: 0, date: daysAgo(i) })
  }
  const res = await GET(authedRequest(user, `/api/progress?planId=${plan.id}`))
  expect((await readJson(res)).missedDays).toContain(isoDate(daysAgo(3)))
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter backend test progress`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `progress/route.ts`**

`GET`, zod on the `planId` query param, 403 if not the caller's plan. Loads the plan's level's LOS tree (with each LOS's topic's `examWeightMin`/`examWeightMax`), the caller's logs for that plan, and the plan's `PlanHoliday` rows (mapped to `DateRange[]`). For each LOS: computes `weightShare` as `((examWeightMin + examWeightMax) / 2) / countOfLosInThatTopic`, and status via `classifyLosFlag` against that LOS's most recent log (confidence, cumulative questionsAnswered/questionsCorrect, most recent log's date as `lastTouchedAt`) against `now`; builds `LosWithStatus[]` and calls `weightedCoveragePercent` for `coveragePercent` and `studyNextList` for `studyNext`. For today: computes `targetCumulative` from `targetDailyPace`/`remainingHours` (passing holiday ranges), partitions today's logs with `splitProgress` (a log's `isFirstEverLog` is true when no earlier log exists for that `losId` on this plan) into `newCoverage`/`reviewWork`, sums them for `actualCumulative`, and calls `behindAhead` and `isPaceRealistic` (required daily hours derived from `targetCumulative` and `targetDailyPace`'s LOS-per-hour rate) for `delta`/`percent`/`paceRealistic`. Calls `missedStudyDays` (passing the same holiday ranges) for `missedDays`. Loads the plan's `PlanPackage` rows to find which `packageId`s are tagged `questions`; for each LOS, groups its logs' `questionsAnswered` by `packageId` (restricted to those `questions`-role packages) and calls `shouldNudgeDiversity` with that LOS's current confidence, collecting `losId`s where it returns true into `diversityNudges`. Calls `recommendedSessionSplit` with the plan's weekly availability total (sum of `weekly_availability`'s seven values) for `recommendedSplit`. Loads `ProgressSnapshot` rows for `history`.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter backend test progress`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/app/api/progress apps/backend/tests/api/progress.test.ts
git commit -m "feat: add progress route (coverage, study-next, behind/ahead)"
```

---

### Task 11: Export and import routes

**Files:**
- Create: `apps/backend/src/app/api/export/all/route.ts`, `apps/backend/src/app/api/export/log/route.ts`, `apps/backend/src/app/api/plans/import/route.ts`
- Test: `apps/backend/tests/api/export.test.ts`

**Interfaces:**
- Consumes: `requireUser` (Task 6), `db` (Task 5).
- Produces: nothing consumed by other backend tasks; this is the (separate) frontend plan's integration surface for the export/import buttons from the spec.

- [ ] **Step 1: Write the failing tests**

```ts
test("export/all returns the user's plan, packages, and every log entry as JSON", async () => {
  const { user, plan } = await setupUserWithPlan()
  const res = await GET(authedRequest(user, "/api/export/all"))
  const body = await readJson(res)
  expect(body.plans).toEqual(expect.arrayContaining([expect.objectContaining({ id: plan.id })]))
})

test("export/log returns CSV with a header row", async () => {
  const { user } = await setupUserWithPlan()
  const res = await GET(authedRequest(user, "/api/export/log"))
  expect(res.headers.get("content-type")).toContain("text/csv")
  const text = await res.text()
  expect(text.split("\n")[0]).toContain("losId")
})

test("importing a plan file creates a new active plan from its contents", async () => {
  const user = await registerUser()
  const shareFile = { levelId: "I", examDate: "2027-06-01", weeklyAvailability: fullWeek }
  const res = await POST(authedRequest(user, "/api/plans/import", shareFile))
  expect(res.status).toBe(201)
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter backend test export`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement the three routes**

`export/all/route.ts`: `GET`, returns `{ plans, packages, logs }` for the caller, every row they own, no pagination (full dump per spec). `export/log/route.ts`: `GET`, streams CSV with header `date,losId,confidence,questionsAnswered,packageId,note`. `plans/import/route.ts`: `POST`, zod validates the same shape as `plans/route.ts`'s `POST` (levelId, examDate, weeklyAvailability, optional packages list), reuses the "deactivate prior active plan" behavior from Task 9.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter backend test export`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/app/api/export apps/backend/src/app/api/plans/import apps/backend/tests/api/export.test.ts
git commit -m "feat: add export (JSON, CSV) and plan-import routes"
```

---

### Task 12: Cron tick route (nightly `ProgressSnapshot`)

**Files:**
- Create: `apps/backend/src/app/api/cron/tick/route.ts`
- Test: `apps/backend/tests/api/cron-tick.test.ts`

**Interfaces:**
- Consumes: `db` (Task 5), `targetDailyPace`, `remainingHours`, `coverageCount` (Task 8), `CRON_SECRET` env var.
- Produces: nothing consumed elsewhere; this is the endpoint the server's host cron hits.

- [ ] **Step 1: Write the failing tests**

```ts
test("tick without the correct bearer secret returns 401", async () => {
  const res = await GET(jsonRequest("GET", "/api/cron/tick"))
  expect(res.status).toBe(401)
})

test("tick writes one ProgressSnapshot per active plan for today", async () => {
  await setupUserWithPlan()
  await setupUserWithPlan()
  const res = await GET(jsonRequest("GET", "/api/cron/tick", undefined, { Authorization: `Bearer ${process.env.CRON_SECRET}` }))
  expect(res.status).toBe(200)
  expect(await db.progressSnapshot.count()).toBe(2)
})

test("running tick twice the same day upserts rather than duplicating the row", async () => {
  await setupUserWithPlan()
  const req = () => GET(jsonRequest("GET", "/api/cron/tick", undefined, { Authorization: `Bearer ${process.env.CRON_SECRET}` }))
  await req()
  await req()
  expect(await db.progressSnapshot.count()).toBe(1)
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter backend test cron-tick`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `cron/tick/route.ts`**

`GET`, checks `Authorization: Bearer <CRON_SECRET>` (constant-time compare), 401 otherwise. For every `StudyPlan` where `isActive`, computes today's `targetCumulative`/`actualCumulative` the same way Task 10 does, and `upsert`s a `ProgressSnapshot` keyed on the `[planId, date]` unique constraint from Task 2.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter backend test cron-tick`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/app/api/cron apps/backend/tests/api/cron-tick.test.ts
git commit -m "feat: add cron tick route for nightly progress snapshots"
```

---

### Task 13: Push subscriptions and the cron tick's missed-day notification

**Files:**
- Create: `apps/backend/src/app/api/push/subscribe/route.ts`, `apps/backend/src/lib/FUNC-push.ts`
- Modify: `apps/backend/src/core/pace.ts` (already has `missedStudyDays` from Task 8), `apps/backend/src/app/api/cron/tick/route.ts` (Task 12)
- Test: `apps/backend/tests/api/push.test.ts`, extend `apps/backend/tests/api/cron-tick.test.ts`

**Interfaces:**
- Consumes: `requireUser` (Task 6), `db` (Task 5), `missedStudyDays` (Task 8), `PushSubscription` model (Task 2), `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT` env vars, the `web-push` package (Task 1).
- Produces: `sendPushToUser(userId: string, payload: { title: string; body: string }): Promise<void>` from `FUNC-push.ts`, consumed by the extended `cron/tick/route.ts`. On a `web-push` send failure with HTTP 404 or 410, `sendPushToUser` deletes that `PushSubscription` row.

- [ ] **Step 1: Write the failing tests for the subscribe route**

```ts
test("POST /api/push/subscribe stores a subscription for the caller", async () => {
  const user = await registerUser()
  const res = await POST(authedRequest(user, "/api/push/subscribe", { endpoint: "https://push.example/abc", keys: { p256dh: "k1", auth: "k2" } }))
  expect(res.status).toBe(201)
  expect(await db.pushSubscription.count({ where: { userId: user.id } })).toBe(1)
})

test("DELETE /api/push/subscribe removes a subscription by endpoint", async () => {
  const user = await registerUser()
  await POST(authedRequest(user, "/api/push/subscribe", { endpoint: "https://push.example/abc", keys: { p256dh: "k1", auth: "k2" } }))
  const res = await DELETE(authedRequest(user, "/api/push/subscribe", { endpoint: "https://push.example/abc" }))
  expect(res.status).toBe(200)
  expect(await db.pushSubscription.count()).toBe(0)
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter backend test push`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `FUNC-push.ts` and `push/subscribe/route.ts`**

`FUNC-push.ts` wraps `web-push`'s `sendNotification`, configured with the VAPID env vars at module load. `sendPushToUser` loads the user's `PushSubscription` rows, sends to each, catches a per-subscription error, deletes the row on 404/410, otherwise logs and continues (one bad subscription never blocks the others). `subscribe/route.ts`: `POST` (zod: `endpoint` url string, `keys.p256dh`, `keys.auth`) upserts by `endpoint`; `DELETE` (zod: `endpoint`) removes the caller's matching row (no-op if absent, still `200`).

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter backend test push`
Expected: PASS

- [ ] **Step 5: Write the failing test for the cron tick's push send**

```ts
test("tick sends a push notification for each user with a missed day and an active subscription", async () => {
  const { user } = await setupUserWithPlan({ weeklyAvailability: fullWeek })
  await db.pushSubscription.create({ data: { userId: user.id, endpoint: "https://push.example/abc", p256dh: "k1", auth: "k2" } })
  const sendSpy = vi.spyOn(pushModule, "sendPushToUser").mockResolvedValue(undefined)
  await GET(jsonRequest("GET", "/api/cron/tick", undefined, { Authorization: `Bearer ${process.env.CRON_SECRET}` }))
  expect(sendSpy).toHaveBeenCalledWith(user.id, expect.objectContaining({ title: expect.any(String) }))
})
```

- [ ] **Step 6: Run to verify failure**

Run: `pnpm --filter backend test cron-tick`
Expected: FAIL, `sendPushToUser` not called (tick doesn't check missed days yet).

- [ ] **Step 7: Extend `cron/tick/route.ts`**

After writing each plan's `ProgressSnapshot` (Task 12), compute `missedStudyDays` for yesterday only, passing that plan's `PlanHoliday` rows so a holiday day is never reported as missed; if yesterday is a missed day and the user has at least one `PushSubscription`, call `sendPushToUser` with a fixed title/body naming the missed weekday.

- [ ] **Step 8: Run to verify pass**

Run: `pnpm --filter backend test cron-tick`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add apps/backend/src/app/api/push apps/backend/src/lib/FUNC-push.ts apps/backend/src/app/api/cron/tick/route.ts apps/backend/tests/api/push.test.ts apps/backend/tests/api/cron-tick.test.ts
git commit -m "feat: add push subscriptions and missed-day push notification"
```

---

### Task 14: OAuth sign-in (Google, GitHub)

**Files:**
- Create: `apps/backend/src/app/api/auth/oauth/[provider]/route.ts`, `apps/backend/src/app/api/auth/oauth/[provider]/callback/route.ts`
- Modify: `apps/backend/src/lib/FUNC-auth.ts` (add `linkOrCreateOauthUser`)

**Interfaces:**
- Consumes: `signJwt` (Task 4), `db` (Task 5), `OAuthAccount` model (Task 2), `GOOGLE_CLIENT_ID/SECRET`, `GITHUB_CLIENT_ID/SECRET`, `OAUTH_REDIRECT_BASE` env vars.
- Produces: nothing consumed by other backend tasks; this is a login alternative the frontend plan links to.

- [ ] **Step 1: Write the failing test**

```ts
test("GET /api/auth/oauth/google redirects to Google's authorization URL with the configured client id", async () => {
  const res = await GET(jsonRequest("GET", "/api/auth/oauth/google"), { params: { provider: "google" } })
  expect(res.status).toBe(302)
  expect(res.headers.get("location")).toContain(process.env.GOOGLE_CLIENT_ID)
})

test("an unknown provider returns 404", async () => {
  const res = await GET(jsonRequest("GET", "/api/auth/oauth/facebook"), { params: { provider: "facebook" } })
  expect(res.status).toBe(404)
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter backend test oauth`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the redirect route and `linkOrCreateOauthUser`**

`oauth/[provider]/route.ts`: `GET`, 404 for anything but `google`/`github`, else `302` to the provider's OAuth authorize URL built from env vars and `OAUTH_REDIRECT_BASE`, with a signed `state` param (reuse `signJwt` with a short TTL as the state token, avoiding a second secret). `linkOrCreateOauthUser(provider, providerAccountId, email)` in `FUNC-auth.ts`: finds an existing `OAuthAccount`, else finds/creates a `User` by email and links it.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter backend test oauth`
Expected: PASS

- [ ] **Step 5: Implement the callback route (not independently unit-tested; it calls a real provider's token endpoint)**

`oauth/[provider]/callback/route.ts`: verifies `state`, exchanges the authorization code for the provider's profile (provider-specific HTTP call), calls `linkOrCreateOauthUser`, redirects to the frontend with the issued JWT as a query param or fragment. Verified manually against a real Google/GitHub app during deploy (Task 17), not in the automated suite.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/app/api/auth/oauth apps/backend/src/lib/FUNC-auth.ts apps/backend/tests/api/oauth.test.ts
git commit -m "feat: add Google/GitHub OAuth sign-in"
```

---

### Task 15: Dockerfile and GitHub Actions deploy workflow

**Files:**
- Create: `apps/backend/Dockerfile`, `apps/backend/.github/workflows/deploy.yml`

**Interfaces:**
- Consumes: nothing from this codebase; copies `cron-server`'s `Dockerfile` and `.github/workflows/deploy.yml`, adjusted for `apps/backend` as the build context and `cfa-study-tracker-api` as the image name.

- [ ] **Step 1: Copy and adapt the Dockerfile**

Same multi-stage shape as `D:\website\cron-server\Dockerfile`: builder stage runs `pnpm install && pnpm --filter backend build` with `DOCKER_BUILD=1`; runner stage copies the standalone output, static assets, and the Prisma client/CLI (needed for `prisma migrate deploy` at deploy time), listens on `0.0.0.0:3000`.

- [ ] **Step 2: Copy and adapt the workflow**

Same shape as `cron-server`'s `.github/workflows/deploy.yml`: on push to `main`, build and push `ghcr.io/great-grayt/cfa-study-tracker-api:latest` (+ SHA tag), SSH to the server, pull, run `prisma migrate deploy` as a one-off `docker compose run` (never inside the long-lived container, per `cron-server`'s `Infra.md` section 10), restart.

- [ ] **Step 3: Commit**

```bash
git add apps/backend/Dockerfile apps/backend/.github/workflows/deploy.yml
git commit -m "chore: add backend Dockerfile and deploy workflow"
```

---

### Task 16: Mock exam logging

**Files:**
- Create: `apps/backend/src/app/api/mock-exams/route.ts`, `apps/backend/src/app/api/mock-exams/[id]/route.ts`
- Test: `apps/backend/tests/api/mock-exams.test.ts`

**Interfaces:**
- Consumes: `requireUser` (Task 6), `db` (Task 5), `MockExam` model (Task 2).
- Produces: nothing consumed by other backend tasks; this is the (separate) frontend plan's integration surface for the mock-exam trend view from the spec.

- [ ] **Step 1: Write the failing tests**

```ts
test("POST /api/mock-exams logs a score for the caller's plan", async () => {
  const { user, plan } = await setupUserWithPlan()
  const res = await POST(authedRequest(user, "/api/mock-exams", { planId: plan.id, date: "2026-11-01", scorePercent: 68 }))
  expect(res.status).toBe(201)
})

test("scorePercent outside 0-100 is rejected with 400", async () => {
  const { user, plan } = await setupUserWithPlan()
  const res = await POST(authedRequest(user, "/api/mock-exams", { planId: plan.id, date: "2026-11-01", scorePercent: 142 }))
  expect(res.status).toBe(400)
})

test("GET /api/mock-exams lists the caller's scores for a plan, ordered by date", async () => {
  const { user, plan } = await setupUserWithPlan()
  await POST(authedRequest(user, "/api/mock-exams", { planId: plan.id, date: "2026-10-01", scorePercent: 55 }))
  await POST(authedRequest(user, "/api/mock-exams", { planId: plan.id, date: "2026-11-01", scorePercent: 68 }))
  const res = await GET(authedRequest(user, `/api/mock-exams?planId=${plan.id}`))
  const body = await readJson(res)
  expect(body.map(m => m.scorePercent)).toEqual([55, 68])
})

test("DELETE /api/mock-exams/:id removes one, 403 if it isn't the caller's", async () => {
  const { user, plan } = await setupUserWithPlan()
  const other = await registerUser()
  const mock = await readJson(await POST(authedRequest(user, "/api/mock-exams", { planId: plan.id, date: "2026-11-01", scorePercent: 68 })))
  expect((await DELETE(authedRequest(other, `/api/mock-exams/${mock.id}`))).status).toBe(403)
  expect((await DELETE(authedRequest(user, `/api/mock-exams/${mock.id}`))).status).toBe(200)
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter backend test mock-exams`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement the routes**

`mock-exams/route.ts`: `POST` (zod: `planId`, `date`, `scorePercent` as `z.number().int().min(0).max(100)`, optional `packageId`, `note`), 403 if `planId` isn't the caller's; `GET` lists the caller's `MockExam` rows for a `planId` query param, ordered by `date` ascending. `mock-exams/[id]/route.ts`: `DELETE`, 403 if not the caller's.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter backend test mock-exams`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/app/api/mock-exams apps/backend/tests/api/mock-exams.test.ts
git commit -m "feat: add mock exam logging routes"
```

---

### Task 17: Server-side setup and first deploy (ops checklist, no code)

**Files:** none (server-side configuration, documented here for the record)

- [ ] **Step 1: DNS**: add `cfa.polarislab.ir` (or Reza's chosen subdomain) as an A record to `142.4.38.81`, or confirm an existing wildcard covers it.
- [ ] **Step 2: Database**: on the server, create role + database `reza_cfa_study_tracker` (or Reza's chosen name), same `CREATE ROLE` / `CREATE DATABASE` pattern as `cron-server`'s `Infra.md` section 2.
- [ ] **Step 3: Project folder and `.env`**: `/srv/apps/reza/cfa-study-tracker/`, `.env` with this plan's vars (Task 1's `.env.example`) plus `DATABASE_URL` pointing at the new database, `chmod 600`.
- [ ] **Step 4: `docker-compose.yml`**: same shape as `cron-server`'s, new `image`/`container_name`.
- [ ] **Step 5: Caddy block**: add the new subdomain's `reverse_proxy` block to `/srv/infra/proxy/Caddyfile`, reload.
- [ ] **Step 6: GitHub repo secrets**: `SSH_HOST`, `SSH_USER`, `SSH_KEY`, `APP_DIR` for this repo.
- [ ] **Step 7: First push and grant GHCR access**: push to `main`, grant `siza-deploy-bot` Read on the new GHCR package, re-run the workflow.
- [ ] **Step 8: Host cron entry**: add a `/srv/scripts/` cron wrapper hitting `https://cfa.<domain>/api/cron/tick` with `Authorization: Bearer $CRON_SECRET`, once daily (unlike `cron-server`'s tick: this one only needs to run after the day's logging is done, not every minute).
- [ ] **Step 9: Run the real curriculum seed on the server**: copy the private `seed-data/*.json` files to the server (outside git, for example via `scp`), run `pnpm db:seed` via `docker compose run`.
- [ ] **Step 10: Smoke test**

```bash
curl -s -o /dev/null -w "%{http_code}" https://cfa.<domain>/api/auth/me
# expect 401 (no token), confirms the route, CORS, and HTTPS are all live
```

- [ ] **Step 11: Commit** (only if any server-config files that live in the repo, e.g. `.env.example` tweaks, changed during this task)

---

## Self-Review

**1. Spec coverage:** Curriculum/copyright maps to Tasks 2-3. Data model maps to Task 2. Confidence/review (including accuracy and staleness flags) maps to Tasks 8-9-10. Pace engine, weighted coverage, new/review split, and the pace-realism check map to Task 8, wired in Task 10. Day-level compliance alerts (in-app) map to Task 8's `missedStudyDays` and Task 10's `missedDays` field. Push notifications map to Task 13. Mid-stream onboarding/backfill maps to Task 2's `startDate` field and Task 9's `initialLogs`. Weekly-availability editing/pausing maps to the existing `PATCH /api/plans/:id` in Task 9 (no new endpoint needed). Holiday ranges map to Task 2's `PlanHoliday` and Task 9's holiday routes. Package roles and the diversity nudge map to Task 2's `PlanPackage`, Task 9's package-role routes, Task 8's `shouldNudgeDiversity`, and Task 10's `diversityNudges` field. The recommended content/practice session split maps to Task 8's `recommendedSessionSplit` and Task 10's `recommendedSplit` field. Mock exams map to Task 16. Import/export maps to Task 11. Auth (password + OAuth) maps to Tasks 4, 6, 14. Hosting/deploy maps to Tasks 15, 17. CORS/rate-limit maps to Task 7. PWA, motion/3D, and screen layout are explicitly out of this plan (frontend plan, separate). Offline-write sync is explicitly out of scope per the spec's confirmed answer. Covered.

**2. Step scan:** Each test step names the exact assertion; each implementation step names the exact file and signature, leaving only the method body (scrypt call shape, HMAC computation, Prisma query construction, the weighted-average arithmetic) to the implementer, which the spec and tests don't otherwise pin. No "TBD"/"handle edge cases" lines remain.

**3. Type consistency:** `requireUser` (Task 6) is used identically in Tasks 9-14 and 16. `LosWithStatus`, `WeeklyAvailability`, `DateRange` (Task 8) are the exact shapes Task 10, 12, and 13 build from the Prisma data. `ProgressSnapshot`'s `[planId, date]` unique constraint (Task 2) is what Task 12's upsert and Task 10's history read both rely on. `classifyLosFlag`'s three-condition input shape is identical wherever Task 10 builds it.

**4. Review Focus:** All five lines have an owning task and test: confidence range maps to Task 9's test. Duplicate email maps to Task 6's test. Past exam date maps to Task 8's and Task 10's tests. Same-LOS-twice coverage maps to Task 8's and Task 10's tests. CORS fail-closed maps to Task 7's test.

**5. Proportion:** The spec is roughly 300 lines (after the CFA-domain review pass); this plan is longer because it covers seventeen independently testable tasks across a full backend (auth, nine resource route groups, a pure engine with ten functions, deploy), which is the expected ratio for an implementation plan at this scope, not a transcript. Code bodies appear only where the spec fixes an exact algorithm (pace math, flagging thresholds) or exact values (rate-limit tiers, schema fields, the 60% accuracy and 30-day staleness thresholds), and even those are given as assertions and signatures rather than full implementations.

---

**Plan complete and saved to `docs/superpowers/plans/2026-11-04-cfa-backend.md`. Please review the plan. Confirming the execution approach from your last message: subagent-driven, each task implemented by a fresh subagent on Haiku or Sonnet (never above Sonnet), a fresh reviewer checking each task before the next starts, me coordinating the whole run and doing the final whole-branch review. Does the plan capture what you want, ready to start Task 1?**
