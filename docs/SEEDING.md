---
title: Seeding a curriculum level
type: spec
module: apps/backend
updated: 2026-11-08
status: active
---

## Purpose

Adding a CFA level's topic, reading and outcome tree to the database, locally
or in production. Written after seeding Level I, where four non-obvious things
cost an hour; each is recorded below so the second level takes minutes.

The app is unusable for a level that is not seeded. Every screen that names an
outcome reads this data, and the onboarding chooser shows an unseeded level as
disabled rather than hiding it.

## Why the data is not in the repository

The outcome wording comes from CFA Institute's topic outline PDFs, which are
candidate-access and marked not for distribution. The product spec's anti-goals
forbid committing it, so `prisma/seed-data/` is gitignored and holds only a
`.gitkeep`. The repository ships the loader and the validator; the content
lives on your machine and on the server.

A consequence worth knowing: the deployed image contains `seed.ts` but an empty
`seed-data/`, which is why seeding always involves mounting the data in.

## The file shape

One file per level, named `level-N.json`, in `apps/backend/prisma/seed-data/`.

```json
{
  "id": "II",
  "version": "2027",
  "topics": [
    {
      "name": "Quantitative Methods",
      "order": 1,
      "examWeightMin": 5,
      "examWeightMax": 10,
      "readings": [
        {
          "name": "Basics of Multiple Regression",
          "order": 1,
          "los": [
            { "text": "describe the types of investment problems addressed by multiple linear regression", "order": 1 }
          ]
        }
      ]
    }
  ]
}
```

Rules the validator enforces:

- `id` is `I`, `II` or `III`.
- `version` names the curriculum edition, for example `"2027"`. Optional, but
  set it: it is echoed by `/api/curriculum` and is how a client holding a
  cached tree learns its outcome ids have changed. Omitted, it falls back to
  the seed date.
- `order` is 1-based, unique and gapless within its parent. It is the only sort
  key, so a duplicate silently reorders the curriculum.
- `examWeightMin` and `examWeightMax` are the official published percentage
  range for that topic. These are public facts, not copyrighted text. Across a
  level, the minimums must sum to at most 100 and the maximums to at least 100,
  or no assignment of weights can total a whole exam and every coverage figure
  will be wrong.
- Every outcome opens with a command verb (`describe`, `explain`, `calculate`
  and so on). This is how truncation is detected: real outcomes are often as
  short as "explain ethics", so length is a useless signal, but a line that has
  lost its opening is caught.

Topic names and exam weights are safe to discuss anywhere. Outcome text is the
part that stays private.

## Adding a new level

### 1. Transcribe

Work from the official topic outline for that level. One topic at a time is
easier to check than one long sitting. Keep the orders sequential as you go
rather than renumbering at the end.

### 2. Validate locally, before anything else

```bash
pnpm --filter backend exec tsx prisma/validate-seed.ts prisma/seed-data/level-2.json
```

It prints the topic, reading and outcome counts, warns on anything suspicious,
and exits non-zero on a real error. Compare the counts against the outline. A
count that is lower than expected means entries were dropped during
transcription, which nothing downstream would ever report.

### 3. Seed locally and click through the app

```bash
pnpm --filter backend db:seed
```

Then run the frontend and complete onboarding for that level. Finding a problem
here costs nothing; finding it in production means reseeding.

### 4. Copy the file to the server

```bash
scp apps/backend/prisma/seed-data/level-2.json reza@142.4.38.81:~/
```

If this fails with `Permission denied (publickey)` while VS Code Remote works,
you are connecting through a host alias in `~/.ssh/config` and `scp` to the
bare IP picks up no identity. Use the alias instead:

```bash
scp apps/backend/prisma/seed-data/level-2.json siza-deploy:~/
```

Dragging the file into VS Code's remote Explorer also works and needs no key
setup.

Check the byte count matches on both sides. A paste into an editor can mangle a
large JSON file in ways the validator will catch but the transfer will not
report.

### 5. Seed on the server

```bash
~/seed-level.sh ~/level-2.json
```

The script (`apps/backend/deploy/seed-level.sh`) stages the file, fixes
ownership, validates, seeds, and prints what is now in the database. Copy it
across once:

```bash
scp apps/backend/deploy/seed-level.sh siza-deploy:~/ && ssh siza-deploy chmod +x ~/seed-level.sh
```

### 6. Confirm

Sign in and start onboarding. The new level should be selectable with the
expected topic and outcome counts. A level present but showing as unavailable
means it has topics but no outcomes.

## Doing it by hand

If the script is unavailable, this is what it runs. Paths assume the defaults.

```bash
# Stage, owned by deploy so the one-off container can read its own mount
sudo mkdir -p /srv/apps/reza/cfa-study-tracker-api/seed-data
sudo cp ~/level-2.json /srv/apps/reza/cfa-study-tracker-api/seed-data/
sudo chown -R deploy:deploy /srv/apps/reza/cfa-study-tracker-api/seed-data

cd /srv/apps/reza/cfa-study-tracker-api

# Validate
sudo -u deploy docker compose run --rm --user 1002:1002 \
  -v /srv/apps/reza/cfa-study-tracker-api/seed-data:/app/apps/backend/prisma/seed-data:ro \
  app node prisma/validate-seed.ts prisma/seed-data/level-2.json

# Seed
sudo -u deploy docker compose run --rm --user 1002:1002 \
  -v /srv/apps/reza/cfa-study-tracker-api/seed-data:/app/apps/backend/prisma/seed-data:ro \
  app node prisma/seed.ts
```

## The four things that are not obvious

Each of these was hit while seeding Level I.

**The container runs as a different user than the files.** The image runs as
`uid 1001 (nextjs)`, but staged files belong to `deploy` (1002) in a directory
that is not world-traversable. Without `--user 1002:1002` the container cannot
read its own mount and fails with `EACCES`. Running as the owning user is
better than widening permissions on the data.

**The runtime image has no `tsx`.** The `db:seed` script in `package.json`
assumes it, so that script does not work in the container. Node 22 strips
TypeScript natively, so `node prisma/seed.ts` works instead.

**Node reparses these files as ES modules.** They use import syntax and the
package has no `"type"` field, so `__dirname` is undefined at run time. This
broke the seed until `seed.ts` was changed to derive its directory from
`import.meta.url`. If you ever see `__dirname is not defined in ES module
scope`, the deployed image predates that fix; the script patches around it
automatically.

**The seed is idempotent.** It upserts on natural keys, so re-running it is
safe and is the correct way to apply a curriculum refresh. It never deletes, so
an outcome removed from a newer outline stays in the database until removed
deliberately.

## Refreshing a level after a yearly update

Bump `version` in the file, reseed, and the new value propagates through
`/api/curriculum`. Clients caching the tree in IndexedDB notice the change and
refetch rather than silently rendering blank rows against ids that no longer
exist.

Existing study logs reference outcome ids. Entries whose outcome is gone from
the new outline still render, labelled as not in the current curriculum, rather
than vanishing or breaking the page.

## Related

- [Frontend deployment runbook](DEPLOY-FRONTEND.md): the rest of taking this app to production.
- [CFA Study Tracker design](superpowers/specs/2026-11-04-cfa-study-tracker-design.md): the product spec, whose anti-goals explain why the data stays private.
