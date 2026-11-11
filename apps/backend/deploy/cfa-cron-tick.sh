#!/bin/sh
# Scheduled tick for cfa-study-tracker-api: writes each active plan's
# ProgressSnapshot for the day and runs the study coach, which is what sends
# the daily email and push notifications.
#
# Runs every 15 minutes, not nightly. The coach has three delivery slots in
# each candidate's own local time (06:30, 20:00, 22:30) and candidates are in
# different time zones, so a once-a-day tick cannot hit them. Firing often is
# cheap and safe: the snapshot upserts, and the per-channel unique key on
# EmailSend turns a repeat attempt at an already-sent slot into a no-op.
#
# CRON_SECRET is read from the app's own server-side .env at run time -
# never duplicated into this script or committed to git. The schedule this
# runs on lives in deploy/cron-schedule, not here; both files are installed
# onto the server by .github/workflows/deploy.yml on every push to main.
set -e
APP_ENV="/srv/apps/reza/cfa-study-tracker-api/.env"

# `cut -d= -f2-` is what this used to do, and it kept the quotes. A .env
# written as CRON_SECRET="abc" therefore sent the 5-character token "abc"
# WITH its quotes, the route compared it against the 3-character value the
# app had loaded (dotenv strips quotes), the lengths differed, and the
# constant-time check returned false. Every tick since the first deploy was
# answered 401: no snapshot was ever written and no notification was ever
# sent. 401 is the correct answer to a caller without the secret, so nothing
# anywhere logged a fault.
#
# sed rather than cut so an `export ` prefix is tolerated, tr for the CR a
# file edited on Windows carries, and the case below strips a matched pair of
# surrounding quotes of either kind.
CRON_SECRET=$(sed -n 's/^[[:space:]]*\(export[[:space:]][[:space:]]*\)\{0,1\}CRON_SECRET=//p' "$APP_ENV" | head -n 1 | tr -d '\r')
case "$CRON_SECRET" in
  '"'*'"') CRON_SECRET=${CRON_SECRET#\"}; CRON_SECRET=${CRON_SECRET%\"} ;;
  "'"*"'") CRON_SECRET=${CRON_SECRET#\'}; CRON_SECRET=${CRON_SECRET%\'} ;;
esac

if [ -z "$CRON_SECRET" ]; then
  echo "cfa-cron-tick: no CRON_SECRET in $APP_ENV; not calling the tick." >&2
  exit 1
fi

# Fail loudly on a non-2xx. The old call swallowed the status, which is how a
# permanent 401 went unnoticed; cron mails the operator on a non-zero exit.
STATUS=$(curl -sS -o /dev/null -w '%{http_code}' \
  -H "Authorization: Bearer $CRON_SECRET" \
  https://cfa.polarislab.ir/api/cron/tick)

echo "cfa-cron-tick: $STATUS"
case "$STATUS" in
  2??) exit 0 ;;
  *) exit 1 ;;
esac
