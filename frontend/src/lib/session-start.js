// How a session's exercise entries are built from a routine. Shared by the live start and by
// "log a past workout", which is the same screen pointed at another day — both must walk up
// to identical entries, or the two paths drift apart the first time a prescription rule changes.
// Imports both history.js and progression.js (which itself imports history.js); nothing in
// either imports this file, so there is no cycle.
import { buildSets, applyIntensifierPlan, modeOf, entryRoutineId, entryExcluded, rerampWarmups } from './history.js'
import { isWarmupRow, modeForSet, isSideSet, makeSideSet, syncSideAggregate, splitBurstReps } from './workout-model.js'
import { nextPrescription, applyPrescription, defaultIncrement, weightIncrement, plannedOf } from './progression.js'
import { dropGrid } from './plates.js'

/**
 * Where a planned session's reps come from (Settings → During a workout). 'plan', the default:
 * the routine's own sets × reps, with history and the progression policy deciding the weight —
 * and a policy that moves reps (double progression, bodyweight, a timed hold) still moving them
 * from there. 'last': the reps you logged last time, the way every planned session opened before
 * this setting existed. 'lastWorkout' copies completed weights and reps without progression.
 * A routine can override the profile's choice. Older profiles still read as 'plan'.
 */
const START_VALUES = ['plan', 'last', 'lastWorkout']
export const startFromOf = (st, routine) => START_VALUES.includes(routine?.startFrom)
  ? routine.startFrom : START_VALUES.includes(st?.startFrom) ? st.startFrom : 'plan'
export const startsFromLast = (st, routine) => startFromOf(st, routine) === 'last'

// Copy only completed values, never the old completion/effort/notes. Keep positions within the
// workout: skipping set 2 must not put set 3's heavier load into that empty slot next time.
const nonnegative = value => Number.isFinite(value) && value >= 0
function usablePrevious(row, target, mode) {
  if (!row?.done || row.skipped || row.skip || modeForSet(row, target) !== mode) return false
  if (mode === 'cardio') return row.min > 0 && Number.isFinite(row.min) && nonnegative(row.speed)
  if (mode === 'time') return row.sec > 0 && Number.isFinite(row.sec) && nonnegative(row.w ?? 0)
  if (isSideSet(row)) return ['L', 'R'].every(side => usablePrevious(row.sides[side], {}, 'reps'))
  return row.r > 0 && Number.isFinite(row.r) && nonnegative(row.w ?? 0)
}

function previousWorkRows(st, cfg, rid) {
  const mode = modeOf(cfg)
  const find = own => {
    const workouts = st.workouts || []
    for (let i = workouts.length - 1; i >= 0; i--) {
      const workout = workouts[i]
      for (const entry of workout.entries || []) {
        if (entry.id !== cfg.id || (own && entryRoutineId(workout, entry) !== rid) || entryExcluded(workout, entry)) continue
        const rows = (entry.sets || []).filter(row => !isWarmupRow(row))
        const usable = rows.map(row => usablePrevious(row, entry.target || {}, mode) ? row : null)
        if (usable.some(Boolean)) return usable
      }
    }
    return null
  }
  return (rid ? find(true) : null) || find(false)
}

function buildPreviousSets(st, cfg, routine, step) {
  // New exercises and added/skipped sets use their current planned values. History from a
  // different mode never supplies undefined weight/reps to a newly configured exercise.
  const grid = dropGrid(st, cfg)
  // Build the planned shape first: rest-pause has one work row regardless of cfg.sets. Applying
  // that plan after copying would overwrite the very rep counts this option promises to keep.
  const baseline = applyIntensifierPlan(
    buildSets({ ...st, workouts: [], exWeights: {} }, cfg, { step, useTarget: true }), cfg, grid)
  const previous = previousWorkRows(st, cfg, routine?.id)
  if (!previous) return { rows: baseline, copied: false }
  const mode = modeOf(cfg)
  let index = 0
  let copied = false
  const rows = baseline.map(row => {
    if (isWarmupRow(row)) return row
    const prev = previous[index++]
    if (!prev) return row
    copied = true
    if (mode === 'cardio') return { ...row, min: prev.min, speed: prev.speed }
    if (mode === 'time') return { ...row, sec: prev.sec, w: prev.w ?? 0 }
    if (isSideSet(row)) {
      if (!isSideSet(prev)) return makeSideSet({ ...row, w: prev.w ?? 0, r: prev.r })
      const sides = Object.fromEntries(['L', 'R'].map(side => [side, {
        ...row.sides[side],
        w: prev.sides[side].w ?? 0, r: prev.sides[side].r, done: false,
      }]))
      return syncSideAggregate({ ...row, sides })
    }
    return { ...row, w: prev.w ?? 0, r: prev.r }
  })
  const firstWork = rows.find(row => !isWarmupRow(row))
  if (cfg.intensifier?.type === 'restpause') {
    // These are fresh planned bursts, never the old completed breakdown. Their sum must match
    // the copied total, independently on each side. Rest-pause's warm-up uses the work load.
    const bursts = row => ({ ...row, type: 'restpause', clusters: splitBurstReps(row.r)
      .map(r => ({ r, restSec: Math.max(5, cfg.intensifier.restSec || 15) })) })
    return { copied, rows: rows.map(row => isWarmupRow(row) ? { ...row, w: firstWork?.w ?? 0 }
      : isSideSet(row) ? syncSideAggregate({ ...row, sides: { L: bursts(row.sides.L), R: bursts(row.sides.R) } })
        : bursts(row)) }
  }
  // rerampWarmups leaves unloaded work unchanged; here the planned load may have been replaced
  // with zero, so clear its old ramp as well rather than suggesting heavier warm-ups than work.
  const ramped = firstWork?.w === 0 ? rows.map(row => isWarmupRow(row) ? { ...row, w: 0 } : row)
    : rerampWarmups(rows, step)
  return { rows: applyIntensifierPlan(ramped, cfg, grid), copied }
}

/**
 * One planned exercise, built the way a session builds it: the prescription, the rows it opens
 * with and the target it is judged against. The session start, a mid-session edit of the
 * exercise, and an exercise added to or swapped into a planned session all build through here,
 * so an entry cannot come out differently depending on where it was made. `routine` is the one
 * the exercise is planned in: its own history comes first (#216) and its policy applies.
 * `noProg` builds the routine's own numbers with no prescription, as an excluded routine does.
 */
export function buildPlannedEntry(st, cfg, routine, { noProg = false } = {}) {
  const previous = !noProg && startFromOf(st, routine) === 'lastWorkout'
  // `plan` is kept on the entry purely so the workout can explain the number it chose.
  const plan = noProg || previous ? { policy: 'off', kind: 'off' } : nextPrescription(st, cfg, routine)
  // The warm-up ramp and the prescription snap to the exercise's own increment (1.25 kg
  // plates exist), not the unit default; a timed exercise's `inc` is seconds, so it keeps the
  // default for its optional load.
  const step = modeOf(cfg) === 'reps' ? weightIncrement(cfg, st.unit) : defaultIncrement(cfg.id, st.unit)
  const planReps = !startsFromLast(st, routine)
  const prior = previous ? buildPreviousSets(st, cfg, routine, step) : null
  const rows = prior ? prior.rows
    : applyPrescription(buildSets(st, cfg, { step, rid: routine?.id, useTarget: plan.kind === 'off', planReps }), plan, step)
  const sets = prior ? rows : applyIntensifierPlan(rows, cfg, dropGrid(st, cfg))
  const target = { ...cfg }
  if (plan.weight != null) target.weight = plan.weight
  if (plan.reps != null) target.reps = plan.reps
  if (plan.sec != null) target.sec = plan.sec
  if (plan.sets != null) target.sets = plan.sets
  // Rows that opened at last session's reps rather than the plan's ("Your last session", and no
  // policy that decided reps), so the workout card can say where the number came from. Written
  // only when true, and never saved with the finished workout.
  const carried = !planReps && plan.kind !== 'off' && plan.reps == null && modeOf(cfg) === 'reps'
    && rows.some(s => !isWarmupRow(s) && s.r !== cfg.reps)
  // `planned` is what the routine asked for, kept apart from the target the prescription moved,
  // so the next session can tell an edited plan from a progressed one (nextPrescription).
  return { target, plan, sets, planned: plannedOf(cfg), ...(carried ? { carried: true } : {}), ...(prior?.copied ? { fromLastWorkout: true } : {}) }
}

/**
 * What an exercise's settings sheet opens with in a running session: the entry's target with the
 * sets and reps (the range, the seconds) its routine planned put back in place of today's.
 *
 * The sheet edits the plan. Today's target is the prescription, and a double-progression aim, a
 * bodyweight climb or a set the rep ceiling added has moved it off the plan. Opened at those
 * numbers, a save that changed nothing stamped them as the plan, and the next build read that as
 * an edit: "Plan changed", the raise undone within the session, the climb started again the next
 * time (#275). The weight stays today's, the one on the bar. An entry built before plans were
 * stamped has only its target.
 */
export function plannedConfigOf(entry) {
  const out = { ...(entry?.target || {}) }
  const planned = entry?.planned
  if (!planned) return out
  for (const key of ['sets', 'reps', 'repsMin', 'sec']) {
    if (planned[key] != null) out[key] = planned[key]
    // A plan with no range has no bottom to keep.
    else if (key === 'repsMin') delete out.repsMin
  }
  return out
}

/**
 * Whether an entry is rebuilt the way an excluded routine builds its exercises: at the routine's
 * own numbers, with no prescription (buildPlannedEntry's `noProg`).
 *
 * `entry.noProg` comes from two places. A deload or rehab routine freezes it onto every exercise
 * it starts, and those are built without a prescription. An exercise's ⋯ menu sets it by hand for
 * one session, and that only stops the session from counting: its rows stay at the prescription.
 * Read as the first kind, a hand-set flag made a rebuild (Progression settings saved, a swap) drop
 * today's 102.5 to the routine's own 60, and its Undo then let those 60 count as progress. So only
 * an entry whose routine is itself kept out is built that way.
 */
export const builtOutOfProgression = (entry, routine) => entry?.noProg === true && routine?.excludeFromProgression === true

// Returns a bare array of session entries. "Excluded from progression" is per-entry now
// (`entry.noProg`, written only when true) rather than a wrapper flag — a rehab routine merged
// into real work must exclude only its own exercises. The merge helper (lib/session-merge.js)
// stamps `entry.rid`, so the single-routine and combined paths share this builder unchanged; it
// only reads the routine's id, to start each exercise from that routine's own history (#216).
export function buildSessionEntries(st, r) {
  // The prescription is applied as the session is built, so you walk up to the bar with the
  // right weight already on the screen instead of being told about it afterwards.
  const noProg = r?.excludeFromProgression === true
  return (r ? r.ex : []).map(cfg => {
    const built = buildPlannedEntry(st, cfg, r, { noProg })
    return { id: cfg.id, sg: cfg.sg, ...built, ...(noProg ? { noProg: true } : {}) }
  })
}
