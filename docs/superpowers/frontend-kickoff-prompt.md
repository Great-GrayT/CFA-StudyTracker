# Frontend kickoff prompt

Paste this into a new Claude Code session, started in `D:\CFA project\CFA project`.

---

The backend for a CFA (Chartered Financial Analyst) exam study-tracker app is fully built, reviewed, and deployed. I need you to build the frontend now, as its own separate effort, not a continuation of the backend's TDD task list.

## Read first

- `docs/superpowers/specs/2026-11-04-cfa-study-tracker-design.md`: the full product spec. Features, data model, UX requirements, PWA/install requirements, the recommended-session-split feature, mock exams, holidays, push notifications, everything.
- `docs/superpowers/plans/2026-11-04-cfa-backend.md`: the backend implementation plan, for the exact route contracts (request/response shapes) you'll be calling.

## What already exists

A Next.js 15 backend, live in production at **`https://cfa.polarislab.ir`**, source in `apps/backend/`. All 16 implementation tasks plus a full whole-branch review cycle are complete and merged to `main`. Routes (all under `/api/`):

- Auth: `POST /auth/register`, `POST /auth/login`, `GET /auth/me`, `POST /auth/password`, `GET /auth/oauth/{google,github}` (redirects to the provider), `GET /auth/oauth/{provider}/callback` (redirects back to `FRONTEND_BASE_URL/auth/callback?token=...`, you need to build that callback page, it just needs to grab `token` from the query string and store it)
- Plans: `POST /plans`, `GET /plans`, `PATCH /plans/:id`, `POST /plans/import`
- Plan sub-resources: `/plans/:id/holidays` (plus `/:holidayId`), `/plans/:id/packages` (plus `/:packageId`)
- Logging: `POST /logs`, `DELETE /logs/:id`
- Mock exams: `POST /mock-exams`, `GET /mock-exams`, `DELETE /mock-exams/:id`
- Packages: `GET /packages`
- Progress: `GET /progress`, this is the big one, returns coverage percent, behind/ahead status, study-next list, pace realism, recommended content/practice split, diversity nudges, missed days
- Export: `GET /export/all`, `GET /export/log`
- Push: `POST /push/subscribe`

Auth is a Bearer JWT, returned on register/login, also delivered via the OAuth callback's query param. `Authorization: Bearer <token>` on every protected request.

## What's NOT done yet (your responsibility, in order)

1. **You haven't created the Vercel project yet.** Once you do, two things need updating on the backend server (I'll walk you through this, it needs SSH access the same way the backend deploy did):
   - `CORS_ALLOW_ORIGINS` in the server's `.env` is currently empty (placeholder), needs your real Vercel origin(s), comma-separated.
   - `FRONTEND_BASE_URL` is currently a placeholder (`https://TODO-set-after-vercel-deploy`), needs your real Vercel URL, or the OAuth callback redirects nowhere real.
2. **Google/GitHub OAuth apps don't exist yet.** I (the user) will create them and paste you the client ID/secret when you reach that point. Don't block on it, password auth already works standalone.
3. **PWA/installable-on-phone** is a spec requirement: manifest, service worker, icons, the works.

## Process, this is important

Do NOT treat this as a TDD task-list build like the backend was. Per my standing workflow:
- Use the `frontend-design` skill for layout/spacing/component-hierarchy/UX decisions before writing any component code. Design review (margins, contrast, focus states, semantic markup, keyboard nav, the user journey) happens before building, not after.
- Use `impeccable` to audit each section once built.
- Brainstorm the screen/IA structure with me first if it isn't obvious from the spec. Don't guess at a layout and run with it.

## Stack

Next.js (React), installable PWA, deployed to Vercel, talking to the backend above. Confirm the exact framework choice (Next.js App Router vs. something else) and state management approach with me before scaffolding, if the spec doesn't already pin it.

## Before you start

Tell me your plan for the first screen/flow you want to design (probably auth plus onboarding, since nothing else works without a logged-in user with a plan), and use `brainstorming` if there's any ambiguity in how it should work. Don't start writing component code before that's settled.
