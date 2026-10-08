# Deploying this personal fork

The customization uses DuarteSantos8/openGym as its base. Source edits do not change the
upstream containers currently running on the Oracle VM. Build on GitHub Actions (or another
machine with Docker), then pull the resulting images onto the 1 GB VM. Do not build there.

## Timer and workout changes

- Tap the timer icon on Home, Start workout, or the pinned workout header. Pick 30 seconds,
  1 minute, 90 seconds, 2 minutes, or 3 minutes; use the minutes/seconds wheels for a custom
  duration from 1 second to 15 minutes. Starting it does not log a set or change automatic
  rest settings. Reset restarts the timer's full duration and resumes a paused timer.
- The sheet can pause/resume, reset, cancel, or replace the current rest. The existing dock
  still offers pause/resume, ±15 seconds, time adjustment, and Skip/Dismiss.
- There is one rest countdown. Starting manually replaces an automatic rest; logging a set
  follows the existing automatic-rest rules and replaces a manual rest when those rules start
  a countdown. Completing the last set can end rest instead. Paused rest is replaced too.
  Starting a timed set takes over; manual rest controls cannot interrupt a timed set.
- Manual rest survives reloads without an active workout. Automatic rest keeps its existing
  requirement for an active workout. Expired timers are not restarted on reload.
- Alerts reuse the existing sound, vibration, flash and per-device push settings and the
  same notification tag. Push scheduling and cancellation are serialized to prevent an
  old request cancelling or resurrecting a replacement timer. Background delivery still
  requires a configured push subscription. There is no iOS Live Activity in this change.
- RepCount inspired the grouped header tools, rounded exercise groups, larger input targets,
  and the compact layout's single surface around the sets. New profiles default to Compact
  and direct number entry. Existing saved layout/control preferences are preserved: select
  **Workout options → Layout → Compact**, then **Settings → Workout → Fine-tuning → +/−
  buttons on numbers** to turn off steppers if desired. Session notes are in Workout options; exercise and set
  menus keep the secondary controls. New timer text uses the existing English fallback
  in locales without a translation.

## 1. Build the images outside Oracle

Local verification: 352 frontend test files / 4,306 tests passed; production Vite build
passed; locale packs remain in sync. The final timer tests cover presets, custom duration,
immediate Start during wheel positioning, pause/resume/reset/cancel, manual/automatic
replacement, timed-set protection, reload recovery, and delayed push request ordering.
Browser checks at widths 320, 390, and 430 found no horizontal overflow. Tests ran on local
Node 25.2.1 with `NODE_OPTIONS=--no-experimental-webstorage` (avoids Node's incomplete global
localStorage overriding the test DOM); CI and Docker use Node 22. Docker is unavailable on
the development machine, so image builds and container health checks must pass in Actions
and on the VM before this deployment is considered verified.

Commit and push the reviewed source changes to `ManavPreetS/openGym` on `main`, or manually
run **Publish Docker images** against the branch containing this change. Enable Actions on
the fork if necessary. Wait for **Tests** and **Publish Docker images** to pass for that
commit. The publish workflow uses the fork owner's GHCR namespace, builds both amd64 and
arm64, and now includes a `sha-<full commit SHA>` tag and a build identifier in the UI.

For this fork the image names are:

```text
ghcr.io/manavpreets/opengym-api:sha-<40-character commit SHA>
ghcr.io/manavpreets/opengym-web:sha-<40-character commit SHA>
```

Make the packages public for unauthenticated pulls, or authenticate the server with a
read-only GHCR token using `docker login ghcr.io --password-stdin`. Keep tokens out of
Git and command history. Docker's [GitHub Actions guide](https://docs.docker.com/build/ci/github-actions/)
describes the build/publish actions used here.

Copy only `deploy/custom-images.yml` from the reviewed checkout to the existing server
directory (run locally after saving the changes):

```bash
ssh ubuntu@140.238.145.156 'mkdir -p ~/openGym/deploy'
scp deploy/custom-images.yml ubuntu@140.238.145.156:openGym/deploy/custom-images.yml
ssh ubuntu@140.238.145.156
cd ~/openGym
```

Do not replace the server's existing `.env` or Compose configuration with a fresh clone.
This [Compose override](https://docs.docker.com/compose/how-tos/multiple-compose-files/merge/)
changes image names only; the existing data mounts, environment, ports, and media stay in place.

## 2. Prepare rollback and a consistent backup

Run the following in a **bash shell** on the VM. Substitute the full SHA from the successful
Actions run. Keep the same shell for all subsequent commands; `dc` holds the image overrides.

```bash
set -euo pipefail
cd ~/openGym
umask 077
export OPENGYM_API_IMAGE='ghcr.io/manavpreets/opengym-api:sha-REPLACE_WITH_FULL_SHA'
export OPENGYM_WEB_IMAGE='ghcr.io/manavpreets/opengym-web:sha-REPLACE_WITH_FULL_SHA'
dc() { docker compose -f docker-compose.yml -f deploy/custom-images.yml "$@"; }
dc config --quiet
dc pull api web

# Hold references to the EXACT running images, even if upstream's latest tag moved.
backup_dir="$HOME/opengym-backups/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$backup_dir"
api_container=$(docker compose ps -q api)
web_container=$(docker compose ps -q web)
test -n "$api_container"
test -n "$web_container"
docker image tag "$(docker inspect --format '{{.Image}}' "$api_container")" opengym-rollback-api:before-custom
docker image tag "$(docker inspect --format '{{.Image}}' "$web_container")" opengym-rollback-web:before-custom
docker image save opengym-rollback-api:before-custom opengym-rollback-web:before-custom | gzip > "$backup_dir/images.tar.gz"
cp docker-compose.yml "$backup_dir/docker-compose.yml"
cp .env "$backup_dir/env"
if [ -f deploy/custom-images.yml ]; then cp deploy/custom-images.yml "$backup_dir/custom-images.yml"; fi

# Stop writes while copying all JSON, passkeys/session/VAPID keys and user uploads.
# A trap restores service if archiving fails. Caddy stays running throughout.
trap 'docker compose start api web' EXIT
docker compose stop web api
sudo tar -czf "$backup_dir/data.tar.gz" data
sudo chown "$(id -u):$(id -g)" "$backup_dir/data.tar.gz"
chmod 600 "$backup_dir/data.tar.gz"
sudo tar -tzf "$backup_dir/data.tar.gz" > /dev/null
docker compose start api web
trap - EXIT
printf 'Backup: %s\n' "$backup_dir"
```

Before updating, copy this backup directory to your computer (in a second local terminal,
substitute the directory printed above), and verify the downloaded archives open:

```bash
mkdir -p "$HOME/opengym-backups"
scp -r ubuntu@140.238.145.156:opengym-backups/TIMESTAMP "$HOME/opengym-backups/"
gzip -t "$HOME/opengym-backups/TIMESTAMP/images.tar.gz" "$HOME/opengym-backups/TIMESTAMP/data.tar.gz"
tar -tzf "$HOME/opengym-backups/TIMESTAMP/data.tar.gz" > /dev/null
```

This is a one-time deployment backup. Automatic encrypted off-server backups remain deferred.
The backup contains private authentication keys and workout data; keep it outside the repository.

## 3. Replace containers using the downloaded images

Back in the same VM shell:

```bash
dc up -d --no-deps --no-build --pull never api web
dc ps
curl -fsS http://127.0.0.1:8080/api/health
curl -fsS https://manavsingh905.duckdns.org/api/health
dc logs --tail=50 api web
```

Keep `RP_ID=manavsingh905.duckdns.org`, `ORIGIN=https://manavsingh905.duckdns.org`,
and `WEB_PORT=127.0.0.1:8080` in the existing `.env`. Leave Caddy, the hostname and firewall
as configured. Do not run `docker compose down -v`, delete `data/`, regenerate keys,
or recreate the profile. Health's user count should reflect the current account(s), not
the historical setup value of zero.

On the iPhone, let cloud sync finish before testing. Reopen the PWA or use its update prompt
to load the new service worker. Check the build suffix in Settings. Verify passkey sign-in,
existing history, manual rest without a logged set, pause/resume/reset/cancel, and automatic
rest replacing manual rest. With push already enabled, lock the phone during a short test
and check that one rest-end alert arrives. Foreground and iPhone push delivery cannot be
proved by desktop unit tests.

Save the selected image references on the VM in a private deployment note, or add just the
two `OPENGYM_*_IMAGE` values to its existing `.env`, so later `dc` commands use the same version.
Future updates use this override and a new tested SHA; an ordinary `docker compose up`
without the override still selects the upstream images.

## 4. Roll back

Do not prune the rollback images. If they are absent, load the saved archive first with
`gzip -dc "$backup_dir/images.tar.gz" | docker image load`. Then:

```bash
export OPENGYM_API_IMAGE=opengym-rollback-api:before-custom
export OPENGYM_WEB_IMAGE=opengym-rollback-web:before-custom
dc up -d --no-deps --no-build --pull never api web
curl -fsS http://127.0.0.1:8080/api/health
```

Start by rolling back images while keeping current data. This change adds no server schema
or authentication migration. If the server had previously run a different upstream release,
validate compatibility before upgrading: the custom images include this checkout's API.
Only restore data if needed; restoring a snapshot loses workouts written afterward.

For a data restore, stop api/web, move the current `data/` to a separate recovery directory
(do not delete it), extract `data.tar.gz` under `~/openGym` using `sudo tar -xzf`, and start
the rollback containers with `dc up -d --no-deps --no-build --pull never api web`. Preserve
the tar archive's ownership and permissions. Restore `.env` from the private `env` copy
only if it was changed. Recheck passkey login and history, and reload the PWA to receive
the rollback frontend.
