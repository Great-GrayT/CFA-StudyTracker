---
title: Seeding a curriculum level
type: spec
module: apps/backend
updated: 2026-11-10
status: active
---

## Purpose

Adding a CFA level's topic, reading and outcome tree to the database, locally
or in production. Written after seeding Level I, where four non-obvious things
cost an hour; each is recorded below so the second level takes minutes.

Levels seeded so far: Level I (version falls back to the seed date, see
Transcribe below) and Level II (version `2027`, 10 topics, 51 readings, 382
outcomes).

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

### 1. Transcribe, or extract

Work from the official topic outline for that level. One topic at a time is
easier to check than one long sitting. Keep the orders sequential as you go
rather than renumbering at the end.

If the outline has already been written up as a research document in the shape
the Level II one used (a topic weights table, a full module index, then one
`## N. Topic` section per topic holding `### N.M Module` headings and `- [ ]`
outcome checklists), do not retype it. `prisma/extract-curriculum.ts` parses it:

```bash
pnpm --filter backend exec tsx prisma/extract-curriculum.ts \
  "../../CFA_Level_II_2027_Curriculum_Deep_Research.md" II 2027 \
  prisma/seed-data/level-2.json
```

The reason it exists rather than a careful typing session is the failure mode:
nothing downstream can tell a dropped outcome from one that was never in the
outline. So the script refuses to write anything unless four independently
authored witnesses agree: the parsed body, the document's own weights-and-counts
table, its separate module index, and a hardcoded expected total. A document
edited in one place only, or a parser that drifts on next year's formatting,
fails loudly instead of emitting a plausible short file.

Set `version` to the curriculum edition here, as the third argument. Level I was
seeded without one, so its version falls back to the seed date and therefore
changes on every reseed, which makes the cache-invalidation signal cry wolf.
Adding `"version": "2026"` to `level-1.json` fixes that whenever Level I is next
touched.

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
safe and is the correct way to apply a curriculum refresh. It never deletes
unless asked to (see Positional drift below), so an outcome removed from a
newer outline stays in the database until removed deliberately.

## Positional drift, and the prune flag

The natural keys are positional: topics match on `(levelId, order)`, readings
on `(topicId, order)`, outcomes on `(readingId, order)`. That makes a reseed
idempotent, but it also means a file whose topic or reading split changed
between editions will reattach child rows to whatever now occupies that
position, and leave any surplus behind. Every screen still renders, which is
what makes it dangerous: the only visible symptom is that exam-weight share
(a topic's weight divided by its outcome count) comes out wrong.

This already happened to Level I in development: Fixed Income readings filed
under Equities, an Equity reading under Corporate Finance, and 118 outcomes
belonging to no reading in the current file.

Check any database whose seeding history you do not know:

```bash
pnpm --filter backend exec tsx prisma/seed.ts --prune --dry-run
```

It reports, per level, how many topics, readings and outcomes the database
holds that the file does not define, and deletes nothing. Drop `--dry-run` to
actually remove them. Prune refuses outright, changing nothing, when any
outcome it would delete carries study log entries: those are the candidate's
own work, and destroying them to tidy the curriculum would be the worse bug.

Prune is opt-in and will stay that way. A seed script that deletes curriculum
rows implicitly is not one you can safely re-run.

Before pruning, satisfy yourself that the file is the better data. A surplus in
the database can equally mean the file is an incomplete transcription, in which
case pruning destroys the good copy.

## Refreshing a level after a yearly update

Bump `version` in the file, reseed, and the new value propagates through
`/api/curriculum`. Clients caching the tree in IndexedDB notice the change and
refetch rather than silently rendering blank rows against ids that no longer
exist.

Existing study logs reference outcome ids. Entries whose outcome is gone from
the new outline still render, labelled as not in the current curriculum, rather
than vanishing or breaking the page.

## Seeding the provider catalogue

A level's curriculum is the skeleton. The provider catalogue is what a
candidate actually watches and answers: which lecture covers which module, how
many questions a reading has. It loads on top of a seeded level and is useless
without one.

### The files

Four gitignored files in `prisma/seed-data/`, built by three scripts:

```bash
# one per provider, from its gitignored research document
pnpm --filter backend exec tsx prisma/extract-meldrum.ts "<doc>.md" prisma/seed-data/package-mm-l2-2026.json
pnpm --filter backend exec tsx prisma/extract-uworld.ts  "<doc>.md" prisma/seed-data/package-uworld-l2-2025.json

# one crosswalk per provider, proposed then reviewed BY HAND once
pnpm --filter backend exec tsx prisma/propose-crosswalk.ts ...
```

Each extractor refuses to write a file whose counts disagree with the
document's own stated totals, so a silently truncated parse cannot reach the
database.

### Validate, then load

```bash
pnpm --filter backend exec tsx prisma/validate-packages.ts \
  prisma/seed-data/package-*.json prisma/seed-data/crosswalk-*.json

pnpm --filter backend db:seed:packages
```

The validator takes `--level <path>` when a crosswalk is staged somewhere other
than beside its level file. Without it the tool cannot tell which curriculum to
check against and says so rather than guessing.

Expected on a correct load: 2 editions, 88 units, 230 resources, 100 mappings,
40 outcome refinements.

### Three things worth knowing

**It fails loudly where the curriculum seed deliberately does not.** `seed.ts`
skips when its data is absent so a CI install never breaks on missing private
files. This loader does the opposite: its foreign keys point at Reading and LOS
rows the curriculum seed creates, so loading without them cannot produce
anything useful. It names the missing level and stops.

**A renumbered curriculum is rejected, not silently rebound.** The crosswalk
resolves a reading by position and then checks the stored name still matches. A
curriculum edition that moves a reading would otherwise bind a provider's
content to a different module, permanently and invisibly.

**A reseed never destroys a measured video duration.** `durationSeconds` is
collected by hand from the provider's player and lives nowhere else, while the
seed file always carries null. The loader's update deliberately omits that one
column. If you add it back, every reseed wipes the measurements with no error.

### Why the catalogue is held to a stricter rule than outcome text

CFA Institute publishes topic names and exam weights, which is why those may be
committed. A provider's folder structure, file names, Drive ids and per-reading
question counts are published nowhere: they exist only because a private
view-only share was enumerated. So provider names, slugs and edition years may
be committed, and nothing else may, including in test fixtures. Tests use
fabricated ids and invented file names.

## Related

- [Daily prescription engine design](superpowers/specs/2026-11-10-daily-prescription-design.md): the provider catalogue that loads after a level is seeded, and why its seed data is held to a stricter rule than outcome text.
- [Frontend deployment runbook](DEPLOY-FRONTEND.md): the rest of taking this app to production.
- [CFA Study Tracker design](superpowers/specs/2026-11-04-cfa-study-tracker-design.md): the product spec, whose anti-goals explain why the data stays private.
