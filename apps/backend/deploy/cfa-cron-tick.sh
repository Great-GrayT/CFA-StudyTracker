#!/bin/sh
# Daily nightly tick for cfa-study-tracker-api: writes each active plan's
# ProgressSnapshot for the day just finished and sends any missed-day push
# notifications. Unlike cron-server's per-minute tick, this app only needs
# to run once the day's logging is realistically over.
#
# CRON_SECRET is read from the app's own server-side .env at run time -
# never duplicated into this script or committed to git. The schedule this
# runs on lives in deploy/cron-schedule, not here; both files are installed
# onto the server by .github/workflows/deploy.yml on every push to main.
set -e
APP_ENV="/srv/apps/reza/cfa-study-tracker-api/.env"
CRON_SECRET=$(grep -m1 '^CRON_SECRET=' "$APP_ENV" | cut -d= -f2-)
curl -fsS -o /dev/null -w 'cfa-cron-tick: %{http_code}\n' \
  -H "Authorization: Bearer $CRON_SECRET" \
  https://cfa.polarislab.ir/api/cron/tick
