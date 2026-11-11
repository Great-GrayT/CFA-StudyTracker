---
title: Backend deployment runbook
type: spec
module: apps/backend
updated: 2026-11-11
status: active
---

## Purpose

Taking the backend from this repository to production, and the three things that
will silently not work if a step is skipped. Written as a checklist because the
order matters: the schema must exist before the app starts, and the study coach
does not send a single email until a scheduler is pointed at it.

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

### Verify

```
GET /api/health
```

200 means usable. 503 means something is set wrongly enough to break a
user-visible feature, and the body names which variables. Point the platform's
health check at it so a bad deploy fails to go live rather than sitting there
serving traffic with a mute coach.

It also catches values left as the examples in `.env.example`, which a presence
check cannot: a deploy that copied that file and changed only `DATABASE_URL`
would otherwise look fully configured while signing tokens with a published
secret.

Warnings keep it at 200. No SMTP and no VAPID are degradations, not faults: the
app is useful without email and useless while refusing traffic.

## Logic

Three failure modes are invisible rather than loud, and each is the reason a
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

## Data flow

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
