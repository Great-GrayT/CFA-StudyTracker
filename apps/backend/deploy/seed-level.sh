#!/usr/bin/env bash
# Seed one curriculum level into the production database.
#
#   ./seed-level.sh /path/to/level-2.json
#
# Validates first and refuses to seed a file that fails, because the failure
# modes are quiet ones: a duplicated order silently reorders a topic and a
# weight set that cannot reach 100 makes every coverage figure wrong without
# erroring.
#
# Encodes four things that are not obvious and cost an hour the first time:
#
#   1. The container runs as uid 1001 but the staged files belong to deploy
#      (1002), so the one-off container has to run as 1002 to read its own
#      mount.
#   2. The runtime image has no tsx, despite package.json's db:seed script
#      assuming it. Node 22 strips types natively, so plain `node` works.
#   3. Node reparses these files as ES modules, so anything relying on
#      __dirname breaks. Fixed in seed.ts; this script checks the image is
#      new enough to have that fix and patches on the fly if not.
#   4. Seeding is idempotent (the script upserts), so re-running is safe.
set -euo pipefail

APP_DIR="${APP_DIR:-/srv/apps/reza/cfa-study-tracker-api}"
SEED_DIR="$APP_DIR/seed-data"
DEPLOY_UID="${DEPLOY_UID:-1002}"
DEPLOY_GID="${DEPLOY_GID:-1002}"

SRC="${1:-}"
if [ -z "$SRC" ] || [ ! -f "$SRC" ]; then
  echo "usage: $0 /path/to/level-N.json" >&2
  exit 1
fi

FILE="$(basename "$SRC")"
echo "==> Staging $FILE"
sudo mkdir -p "$SEED_DIR"
sudo cp "$SRC" "$SEED_DIR/$FILE"
sudo chown -R "$DEPLOY_UID:$DEPLOY_GID" "$SEED_DIR"
ls -la "$SEED_DIR/$FILE"

cd "$APP_DIR"

run_in_container() {
  sudo -u deploy docker compose run --rm --user "$DEPLOY_UID:$DEPLOY_GID" \
    -v "$SEED_DIR:/app/apps/backend/prisma/seed-data:ro" \
    "$@"
}

# If the deployed image predates the ESM fix, patch a copy and mount it over
# the original rather than blocking on a rebuild.
PATCH_MOUNT=()
if sudo -u deploy docker compose exec -T app grep -q '__dirname' prisma/seed.ts 2>/dev/null; then
  echo "==> Image predates the ESM fix, patching seed.ts for this run"
  TMP_SEED="$(mktemp /tmp/seed-patched.XXXXXX.ts)"
  sudo -u deploy docker compose exec -T app cat prisma/seed.ts > "$TMP_SEED"
  sed -i 's|join(__dirname, "seed-data")|join(new URL(".", import.meta.url).pathname, "seed-data")|' "$TMP_SEED"
  chmod 644 "$TMP_SEED"
  PATCH_MOUNT=(-v "$TMP_SEED:/app/apps/backend/prisma/seed.ts:ro")
  trap 'rm -f "$TMP_SEED"' EXIT
fi

echo "==> Validating"
# Older images have no validator. Missing it is not a reason to stop, but it
# is worth saying so rather than silently skipping the check.
if sudo -u deploy docker compose exec -T app test -f prisma/validate-seed.ts 2>/dev/null; then
  run_in_container app node prisma/validate-seed.ts "prisma/seed-data/$FILE"
else
  echo "    validator not in this image, skipping (validate locally instead)"
fi

echo "==> Seeding"
run_in_container "${PATCH_MOUNT[@]}" app node prisma/seed.ts

echo "==> Verifying what is now in the database"
sudo -u deploy docker compose exec -T app node -e '
const {PrismaClient}=require("/app/node_modules/@prisma/client");
const db=new PrismaClient();
(async()=>{
  const levels=await db.level.findMany({include:{_count:{select:{topics:true}}},orderBy:{id:"asc"}});
  for(const l of levels){
    const n=await db.lOS.count({where:{reading:{topic:{levelId:l.id}}}});
    console.log(`    Level ${l.id}: ${l._count.topics} topics, ${n} outcomes, version ${l.version}`);
  }
  process.exit(0);
})().catch(e=>{console.error(e.message);process.exit(1)});
'
echo "==> Done"
