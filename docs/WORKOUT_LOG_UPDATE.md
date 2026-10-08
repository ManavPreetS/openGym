# Last workout values and the workout log

## Use the new controls

- **Settings → Workout → Progression → Planned sessions start from → Last workout**
  makes new planned sessions start with the completed weights, reps and durations from
  the previous session. It does not automatically increase them. This also appears in
  the in-workout settings sheet.
- For one routine, open **Routines → your routine → Progression → Planned sessions
  start from**. Choose **Last workout**, or **Use workout setting** to inherit the
  setting above. The routine override travels with exported/imported plans.
- Previous values come from that routine first, then another routine containing the same
  exercise if there is no usable history for this routine. Skipped, incomplete, added and
  incompatible sets use the routine's planned values. Deload routines retain their own
  prescribed values. New sets are unchecked and do not inherit old effort or notes.
- Warm-ups are recalculated for the working load. Drop steps and rest-pause bursts are
  rebuilt from the current routine's configuration; they are not a replay of the old
  completed breakdown. Rest-pause totals retain the completed reps.
- **Plan + progression** retains the normal automatic progression behavior. **Last reps
  + progression** retains the older reps-only carry-over behavior. Existing preferences
  are not silently changed.

The bottom navigation now has **Home, Routines, Start, Log, Stats**. Exercise library is
available from Home. Routines opens a simple grouped list; Schedule is one tap away.

**Log** groups past workouts by month. Search by workout name, exercise or session note.
Tap a workout to see each recorded set, warm-ups, weights/reps, left/right results,
effort, timed/cardio values, notes, bodyweight, duration and start/end times when recorded.
Edit, repeat, note editing, exports and deletion remain under **Workout options**.

The Compact workout screen keeps previous values, number entry, completion, Add set,
Finish and the rest timer easy to reach. Secondary exercise controls stay in the ⋯ menu.
For an existing profile with extra controls enabled, use **Workout options → Simplify
screen** once. It saves Compact layout and direct number entry, without changing logged
values. Individual preferences remain available in Settings.

The visual direction uses the grouped lists and quiet exercise cards in the supplied
RepCount screenshots. Reference research: [RepCount features](https://www.repcountapp.com/features),
[Hevy exercise tracking](https://www.hevyapp.com/features/track-exercises/), and
[Strong exercise details](https://help.strongapp.io/article/237-about-exercise-detail).

## Deploy this update

This is a frontend change; there is no server data or authentication migration. Your
running app stays on its current version until the new images are published and pulled.
Use the already configured GitHub Actions build; the Oracle VM only pulls images.

1. Commit and push these source changes to your fork's `main` branch.
2. Wait for **Tests** and **Publish Docker images** to pass for that commit.
3. Copy the full commit SHA from that successful run. The packages are already public,
   so no visibility change or Docker login is needed.
4. SSH into the existing server using your configured private key. In the server shell,
   run the following, replacing the placeholder with that SHA:

```bash
cd ~/openGym
export OPENGYM_API_IMAGE='ghcr.io/manavpreets/opengym-api:sha-REPLACE_WITH_FULL_SHA'
export OPENGYM_WEB_IMAGE='ghcr.io/manavpreets/opengym-web:sha-REPLACE_WITH_FULL_SHA'
dc() {
  sudo env OPENGYM_API_IMAGE="$OPENGYM_API_IMAGE" OPENGYM_WEB_IMAGE="$OPENGYM_WEB_IMAGE" \
    docker compose -f docker-compose.yml -f deploy/custom-images.yml "$@"
}
dc config --quiet
dc pull api web
dc up -d --no-deps --no-build --pull never api web
dc ps
curl -fsS http://127.0.0.1:8080/api/health
curl -fsS https://manavsingh905.duckdns.org/api/health
```

Update only the two `OPENGYM_API_IMAGE` and `OPENGYM_WEB_IMAGE` lines in the server's
existing `.env` to those same image references for subsequent Compose commands. Keep
using both Compose files. The existing `data/` mount, `.env` authentication settings,
hostname, Caddy configuration and ports remain in place. There is no need to delete the
old app or rebuild on Oracle. Do not use `down -v` or remove the data directory.

On the iPhone, reopen the PWA and accept its update prompt when shown. Confirm the new
build suffix in Settings, choose **Last workout**, start a routine and compare the
unchecked set values with its previous entry in **Log**. Also try the manual rest timer.

## Verification

The full frontend suite passed: **354 files / 4,337 tests**, followed by **6 new
workout-detail integration tests**. The production Vite build passed, all 17 locale
packs remain in sync, and the fatigue/history-edit property probes passed. The build
continues to report the project's existing large-chunk/dynamic-import warnings.

Development verification uses the bundled Node 24 runtime with
`--no-experimental-webstorage`; the locally installed Node 25 stalled the DOM test
workers. CI and Docker retain Node 22. Automated checks cover value carry-over, routine
overrides, imports, partial/skipped sets, timed/cardio work, warm-ups, unilateral sets,
rest-pause/drop plans, history search and detail rendering, navigation and workout menus.

Browser checks use synthetic local guest data, separate from the hosted account. A saved
80×10 / 77.5×9 / 75×8 workout was opened from Log, then carried into a new routine exactly.
Manual rest start, pause and cancellation were checked. Responsive layouts were checked
at 320, 390 and 430 pixels. Desktop browser checks do not replace a real iPhone/PWA smoke test.
New copy uses English fallback where locale translations are not yet available.
