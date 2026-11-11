#!/usr/bin/env bash
#
# Load the curriculum and provider catalogue into a deployed database.
#
# This exists because the deploy cannot do it and never will be able to. The
# curriculum text and the provider inventories are licensed, so
# apps/backend/prisma/seed-data/*.json is gitignored, which also keeps it out of
# the Docker image. seed.ts finds no files and skips without complaint, so a
# fresh deploy comes up migrated, configured, and unable to generate a single
# study task.
#
# The data is 254KB raw and 59KB gzipped, over GitHub's 48KB secret ceiling, so
# it cannot travel through Actions either. It has to go from a machine that
# holds it, which is why this is a local script rather than a workflow.
#
# Safe to re-run. Both seeds upsert and never delete, which is also how a
# curriculum revision is applied.
#
# Usage:
#   scripts/seed-production.sh <ssh-host> <app-dir>
#   scripts/seed-production.sh fintech-deploy /srv/cfa
#
# Or set SEED_HOST and SEED_APP_DIR and run it with no arguments.

set -euo pipefail

HOST="${1:-${SEED_HOST:-}}"
APP_DIR="${2:-${SEED_APP_DIR:-}}"

if [[ -z "$HOST" || -z "$APP_DIR" ]]; then
  echo "Usage: $0 <ssh-host> <app-dir>" >&2
  echo "   or: SEED_HOST=... SEED_APP_DIR=... $0" >&2
  exit 2
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SEED_DIR="$REPO_ROOT/apps/backend/prisma/seed-data"
REMOTE_SEED_DIR="$APP_DIR/seed-data"

# Named explicitly rather than globbed, so a half-populated local directory
# fails here instead of seeding a partial curriculum that looks complete.
REQUIRED=(
  level-1.json
  level-2.json
  package-mm-l2-2026.json
  package-uworld-l2-2025.json
  crosswalk-mm-l2-2026.json
  crosswalk-uworld-l2-2025.json
)

echo "Checking local seed data..."
missing=0
for file in "${REQUIRED[@]}"; do
  if [[ ! -f "$SEED_DIR/$file" ]]; then
    echo "  MISSING: $file" >&2
    missing=1
  fi
done
if [[ $missing -eq 1 ]]; then
  echo >&2
  echo "Seed data is incomplete. These files are gitignored by design, so they" >&2
  echo "exist only on a machine that generated them from the private research" >&2
  echo "documents. Nothing here can recreate them." >&2
  exit 1
fi
echo "  all ${#REQUIRED[@]} files present"

echo
echo "Target: $HOST:$APP_DIR"
echo "This writes curriculum and catalogue rows into that deployment's database."
echo "It is additive and idempotent: nothing is deleted, and re-running is safe."
read -r -p "Continue? [y/N] " reply
if [[ ! "$reply" =~ ^[Yy]$ ]]; then
  echo "Stopped. Nothing was sent."
  exit 0
fi

echo
echo "Copying seed data..."
ssh "$HOST" "mkdir -p '$REMOTE_SEED_DIR'"
scp "$SEED_DIR"/*.json "$HOST:$REMOTE_SEED_DIR/"

# Mounted read-only: the seed reads these files and has no business writing to
# them, and a read-only mount makes that structural rather than a convention.
MOUNT="$REMOTE_SEED_DIR:/app/apps/backend/prisma/seed-data:ro"

echo
echo "Seeding curriculum (levels, topics, readings, outcomes)..."
ssh "$HOST" "cd '$APP_DIR' && docker compose run --rm -v '$MOUNT' app pnpm --filter backend db:seed"

# Strictly after the curriculum: package units link to readings that must
# already exist, so the reverse order silently produces zero mappings.
echo
echo "Seeding provider catalogue (editions, units, resources, mappings)..."
ssh "$HOST" "cd '$APP_DIR' && docker compose run --rm -v '$MOUNT' app pnpm --filter backend db:seed:packages"

echo
echo "Verifying..."
# From inside the server, so this works whether or not the API is public.
ssh "$HOST" "curl -fsS localhost:3000/api/health || curl -fsS localhost:8080/api/health" \
  | grep -oE '"seeded":(true|false)|"readings":[0-9]+|"catalogueResources":[0-9]+' \
  || echo "  health endpoint not reachable on the usual ports; check it yourself"

echo
echo "Done. Expected on a clean load:"
echo "  2 levels, 20 topics, 153 readings, 722 outcomes"
echo "  2 editions, 88 units, 230 resources, 100 mappings"
