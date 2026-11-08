---
title: Frontend deployment runbook
type: spec
module: apps/frontend
updated: 2026-11-08
status: active
---

## Purpose

Taking the frontend from this repository to production on Vercel, and the two
server-side changes that must follow it. Written as a checklist because the
steps have a required order: the Vercel URL does not exist until step 2, and
three later settings depend on knowing it.

Steps marked **(you)** need credentials this repository does not and should not
hold. Everything else is already done.

## What is already done

- The app builds clean: typecheck, 33 frontend tests, 151 backend tests, and a
  production build with every route inside the 180KB first-load budget.
- `BACKEND_BASE_URL` is the only server-side variable the app needs, plus an
  optional `NEXT_PUBLIC_VAPID_PUBLIC_KEY` for push.
- CI runs typecheck, tests and build on every pull request touching
  `apps/frontend/`.

## 1. Generate a VAPID keypair (you)

Push notifications need one. The backend already has a pair in its own `.env`;
the frontend needs only the **public** half, and it must be the same pair.

```bash
# On the server, or anywhere with the backend's dependencies:
node -e "console.log(JSON.stringify(require('web-push').generateVAPIDKeys(),null,2))"
```

If the backend already has `VAPID_PUBLIC_KEY` set, use that value and do not
generate a new one. Rotating the pair invalidates every existing subscription.

## 2. Create the Vercel project (you)

From the repository root:

```bash
npx vercel link
```

Answer the prompts, then set the root directory to `apps/frontend` in the
project settings. Vercel detects Next.js and needs no build-command override;
the monorepo install works because pnpm workspaces resolve from the root.

Set these environment variables in the Vercel dashboard, for Production,
Preview and Development:

| Variable | Value | Notes |
| --- | --- | --- |
| `BACKEND_BASE_URL` | `https://cfa.polarislab.ir` | Server-side only. Deliberately not `NEXT_PUBLIC_`: the browser never learns the API origin, which is what lets the CSP stay at `connect-src 'self'` |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | the public key from step 1 | Genuinely public, it is the public half of an asymmetric pair |

Then deploy:

```bash
npx vercel --prod
```

Note the production URL. Everything below needs it.

## 3. Update the backend's environment (you, over SSH)

Two values on the server are still placeholders. Until both are set, OAuth
redirects nowhere real.

```bash
ssh reza@142.4.38.81
sudo nano /srv/apps/reza/cfa-study-tracker-api/.env
```

Set:

```
CORS_ALLOW_ORIGINS=https://<your-vercel-domain>
FRONTEND_BASE_URL=https://<your-vercel-domain>
```

If you use a custom domain as well as the `.vercel.app` one, list both in
`CORS_ALLOW_ORIGINS`, comma separated, with no spaces.

A note on CORS, because it is easy to over-set: the browser never calls the
backend directly. Every API call goes through the same-origin proxy at
`/api/proxy/*`, which runs server-side on Vercel and is not subject to CORS at
all. `CORS_ALLOW_ORIGINS` is therefore defence in depth rather than load
bearing. `FRONTEND_BASE_URL` genuinely is load bearing: it is where the OAuth
callback redirects.

Restart the container:

```bash
cd /srv/apps/reza/cfa-study-tracker-api && docker compose up -d --force-recreate
```

## 4. Create the OAuth apps (you)

Password sign-in works without this; do it when you want Google or GitHub.

**Google**: console.cloud.google.com, APIs and Services, Credentials, Create
OAuth client ID, Web application. Authorised redirect URI:

```
https://cfa.polarislab.ir/api/auth/oauth/google/callback
```

**GitHub**: Settings, Developer settings, OAuth Apps, New OAuth App.
Authorization callback URL:

```
https://cfa.polarislab.ir/api/auth/oauth/github/callback
```

Both callbacks point at the **backend**, not at Vercel. The backend handles the
exchange and then redirects to `FRONTEND_BASE_URL/auth/callback?token=...`,
which is why step 3 must be done first.

Put the four values into the server's `.env` (`GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`) and restart.

## 5. Seed the curriculum (you, if not already done)

The app is unusable without it: every screen that names an outcome reads the
curriculum tree.

```bash
# Seed data is private and gitignored. Copy it to the server first.
scp -r prisma/seed-data reza@142.4.38.81:/tmp/
# Then inside the container:
docker compose exec api pnpm db:seed
```

Each seed file may carry a `version` string (for example `"2027"`). It is
echoed by `/api/curriculum` and lets a client holding a stale cached tree
notice that outcome ids have changed. If omitted it defaults to the seed date.

## 6. Verify

In order, because each step depends on the one before:

1. Open the Vercel URL. You should land on `/login`.
2. Create an account. You should land on `/onboarding`.
3. Complete onboarding. If the level chooser shows no levels, step 5 is
   incomplete.
4. Log a session. Today's numbers should change immediately.
5. Open `/watchdogs`. The schedule should read `0 3 * * *`. Press "Run now"
   and confirm a run appears.
6. Install to a phone home screen, then grant notifications from `/watchdogs`.
   On iOS this only works once installed; the screen says so.

## Known gaps at launch

Stated plainly rather than discovered later.

- **Password recovery does not exist.** `/api/auth/forgot-password` has a
  rate-limit tier in the backend's middleware and no route behind it. The sign
  in screen says so rather than offering a dead link. Building it needs an
  email sender, which the product spec puts out of scope.
- **`/api/progress` reports a unit-mismatched delta.** Its `actualCumulative`
  counts log rows while `targetCumulative` counts distinct outcomes, so
  re-logging an outcome inflates it. The frontend computes its own figure from
  the log history and does not render the API's. Fixing it server side means
  using `coverageCount`, which already exists in `src/core/pace.ts`.
- **Offline is read only.** Logging needs a connection, and the interface says
  so in place. An offline write queue is a v2 candidate per the product spec.

## Related

- [CFA Study Tracker frontend design](superpowers/specs/2026-11-07-cfa-frontend-design.md): what was built and why.
- [CFA Study Tracker screens and copy](superpowers/specs/2026-11-07-cfa-frontend-screens.md): the screens and every state's copy.
- [CFA Study Tracker design](superpowers/specs/2026-11-04-cfa-study-tracker-design.md): the product spec.
