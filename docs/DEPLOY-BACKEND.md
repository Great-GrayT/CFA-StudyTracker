---
title: Backend deployment runbook
type: spec
module: apps/backend
updated: 2026-11-11
status: active
---

## Purpose

Taking the backend from this repository to production, and the four things that
will silently not work if a step is skipped. Written as a checklist because the
order matters: the schema must exist before the app starts, the curriculum must
be loaded before a plan can hold a single task, and the study coach does not
send one email until a scheduler is pointed at it.

Steps marked **(you)** need credentials or infrastructure this repository does
not and should not hold.

## Methods

### Apply the schema

```
pnpm --filter backend exec prisma migrate deploy
```

`migrate deploy` only ever applies migrations forward and never resets
anything, which is why it is the production command.

Never use `prisma db push` against production. Push is for local iteration: it
syncs the schema and records no history, so a column added that way exists on
the developer's machine and nowhere else. That is exactly how this project
accumulated five undeployable changes before `20261111180000` caught them up.

To check a deployment before trusting it:

```
pnpm --filter backend exec prisma migrate status
```

### Set the environment **(you)**

`apps/backend/.env.example` lists every variable and says what each one breaks
when it is wrong. Four cannot be skipped:

| Variable | What happens without it |
|---|---|
| `DATABASE_URL` | nothing works |
| `JWT_SECRET` | nothing works; it also signs unsubscribe links |
| `FRONTEND_BASE_URL` | the coach refuses to send, because every link would be dead |
| `CRON_SECRET` | the batch rejects every call, silently, forever |

Generate the push keypair once:

```
npx web-push generate-vapid-keys
```

`VAPID_SUBJECT` must be a `mailto:` or `https:` URL. A bare email address makes
web-push throw at module load, which takes down every route importing it rather
than merely disabling notifications.

### Schedule the batch **(you)**

```
GET /api/cron/tick
Authorization: Bearer $CRON_SECRET
```

**Every 15 to 30 minutes, not nightly.** The progress-snapshot half of the tick
is a once-a-day job, which makes nightly look sufficient, but the study coach
has three delivery slots in each candidate's own local time (06:30, 20:00,
22:30) and candidates are in different zones. A nightly tick would miss almost
all of them.

Running it often is cheap and safe. A slot stays due until it is actually sent,
and the per-channel unique key on `EmailSend` makes a repeat attempt a no-op
rather than a duplicate, so being late costs nothing and firing twice sends
once.

### Load the curriculum **(you)**

**The deploy does not do this, and nothing in CI can.** The curriculum text and
the provider inventories are licensed, so `apps/backend/prisma/seed-data/*.json`
is gitignored, which also means it is absent from the Docker image. `seed.ts`
finds no files and skips without complaint.

A deploy therefore comes up migrated, configured, and completely unable to
generate a study task. `/api/health` reports `seeded: false` and returns 503
for exactly this reason; on a first deploy that 503 is the expected state until
this step is done.

BOTH seeds count. `seeded` is true only when the curriculum AND the provider
catalogue are loaded, because the scheduler builds tasks out of package
resources: a curriculum on its own produces empty plans. The first real
deployment of this app sat with 102 readings and zero catalogue resources, so
the second script is not optional and is easy to forget.

Copy the six files to the server, out of band, then seed from a one-off
container with the directory mounted:

```
scp apps/backend/prisma/seed-data/*.json <server>:/srv/cfa/seed-data/

# on the server, from the compose project directory
MOUNT=/srv/cfa/seed-data:/app/apps/backend/prisma/seed-data:ro

docker compose run --rm -v $MOUNT app pnpm --filter backend db:seed
docker compose run --rm -v $MOUNT app pnpm --filter backend db:seed:packages
```

If `docker compose` is unavailable to you because the project's `.env` is
readable only by the deploy user, go through the running container instead. It
already holds `DATABASE_URL` in its environment, so no `.env` access is needed:

```
for f in ~/cfa-seed-data/*.json; do
  docker cp "$f" <container>:/app/apps/backend/prisma/seed-data/
done

TSX=/app/node_modules/.pnpm/tsx@4.23.15/node_modules/tsx/dist/cli.mjs
docker exec -w /app/apps/backend <container> node $TSX prisma/seed.ts
docker exec -w /app/apps/backend <container> node $TSX prisma/seed-packages.ts
```

The image ships the seed scripts and tsx but no `.bin` shim, so tsx is invoked
through its `cli.mjs` rather than by name. Files copied this way live in the
container's writable layer and vanish on the next deploy, which is fine: only
the database rows need to persist.

Order matters: `db:seed` loads levels, topics, readings and outcomes;
`db:seed:packages` links provider units to readings that must already exist.

Both are idempotent and additive. They upsert and never delete, so re-running
them is safe and is how a curriculum revision is applied. The flip side is that
a row whose natural key changed between revisions is not removed: the dev
database currently carries 9 readings and 118 outcomes from an earlier key
shape that no seed file describes any more. A database seeded from scratch gets
the correct 153 readings and 722 outcomes, so this only affects long-lived
development databases. `prisma/validate-seed.ts` reports the drift, and the
prune is opt-in and refuses when a study log references a doomed row.

Expected on a clean load:

```
Seed complete: 2 level(s), 20 topic(s), 153 reading(s), 722 LOS.
Catalogue seed complete: 2 edition(s), 88 unit(s), 230 resource(s), 100 mapping(s), 40 outcome refinement(s).
```

### Verify

```
GET /api/health
```

200 means usable. 503 means something is wrong enough to break a user-visible
feature, and the body says what: `configuration.errors` names the variables at
fault, and `seeded: false` means the curriculum has not been loaded. Point the
platform's health check at it so a bad deploy fails to go live rather than
sitting there serving traffic with a mute coach and an empty curriculum.

It also catches values left as the examples in `.env.example`, which a presence
check cannot: a deploy that copied that file and changed only `DATABASE_URL`
would otherwise look fully configured while signing tokens with a published
secret.

Warnings keep it at 200. No SMTP and no VAPID are degradations, not faults: the
app is useful without email and useless while refusing traffic. An unseeded
curriculum is not a warning, because an app that cannot produce a single task is
not degraded, it is not working.

## Logic

Four failure modes are invisible rather than loud, and each is the reason a
check above exists.

A missing `CRON_SECRET` produces no error anywhere. `401` is the correct
response to a caller without the secret, so the route behaves exactly as
designed while no snapshot is ever written and no email is ever sent. Only
`/api/health` reports it.

A missing `FRONTEND_BASE_URL` used to be worse than silent: the coach defaulted
to an example domain and sent perfectly deliverable emails in which every link
was dead, the unsubscribe link included. It now refuses to send and logs why.
The refusal is a deferral, not a lost day: nothing is claimed, so the same slot
goes out once the variable is set.

A deploy with no migration for a recent schema change starts normally and fails
only when a request touches the missing column, which can be days later.
`migrate status` is the cheap check.

An unseeded database is the quietest of the four, because every component is
genuinely working. The app serves, the database answers, sign-in succeeds, and
the first candidate to build a plan gets an empty one. Since the seed data
cannot travel in the image by design, this step can only ever be manual, so the
health endpoint reports it rather than relying on anybody remembering.

## Data flow

Operator -> scp seed-data -> one-off container -> db:seed then db:seed:packages
-> curriculum, outcomes, provider units and resources.

Scheduler -> GET /api/cron/tick -> per active plan: write snapshot -> run coach
-> claim EmailSend row per channel -> SMTP and Web Push -> mark sent.

Candidate -> unsubscribe link or mail client control -> POST
/api/coach/unsubscribe -> StudyPlan.emailCoach or pushCoach set to off.

Platform health check -> GET /api/health -> checkConfig plus one database round
trip -> 200 or 503.

## Dependencies

- [Frontend deployment runbook](DEPLOY-FRONTEND.md): `FRONTEND_BASE_URL` is that
  deployment's origin, and the coach, password reset and every passkey ceremony
  build links from it.
- [Seeding](SEEDING.md): the curriculum and provider catalogue a plan needs
  before it can generate a single task.
- Postgres, reachable from the app.
- An SMTP relay for the coach and for password reset.

## Related

- [Frontend deployment runbook](DEPLOY-FRONTEND.md): the other half of a
  deployment, and the source of `FRONTEND_BASE_URL`.
- [Seeding](SEEDING.md): what to load once the schema is applied.
