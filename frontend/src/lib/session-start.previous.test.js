import { describe, it, expect } from 'vitest'
import { buildSessionEntries } from './session-start.js'
import { isWarmupRow, makeSideSet, syncSideAggregate } from './workout-model.js'

const cfg = { id: '0025', sets: 3, reps: 8, weight: 40, mode: 'reps', prog: 'linear' }
const workout = (sets, extra = {}) => ({
  d: '2026-10-06', routineIds: ['upper'],
  entries: [{ id: cfg.id, target: cfg, sets }], ...extra,
})
const state = workouts => ({ unit: 'kg', workouts, routines: [], exWeights: {}, startFrom: 'lastWorkout' })
const routine = (extra = {}) => ({ id: 'upper', prog: 'linear', ex: [cfg], ...extra })
const values = entry => entry.sets.filter(s => !isWarmupRow(s)).map(s => [s.w, s.r])
const logged = (w, r, extra = {}) => ({ w, r, done: true, ...extra })

describe('start a routine from the last workout', () => {
  it('copies each completed weight and rep count exactly, without progression or old completion metadata', () => {
    const st = state([workout([logged(80, 10, { rir: 1, note: 'Hard' }), logged(77.5, 9), logged(75, 8)])])
    const snapshot = structuredClone(st)
    const [entry] = buildSessionEntries(st, routine())
    expect(values(entry)).toEqual([[80, 10], [77.5, 9], [75, 8]])
    expect(entry.plan.kind).toBe('off')
    expect(entry.fromLastWorkout).toBe(true)
    entry.sets.forEach(s => {
      expect(s.done).toBe(false)
      expect(s.rir).toBeUndefined()
      expect(s.note).toBeUndefined()
    })
    expect(st).toEqual(snapshot)
  })

  it('keeps skipped positions and new rows on the current plan; warm-ups never shift working sets', () => {
    const st = state([workout([logged(20, 12, { phase: 'warmup' }), logged(80, 10), logged(90, 1, { done: false }), logged(75, 7)])])
    const [entry] = buildSessionEntries(st, routine({ ex: [{ ...cfg, sets: 4, warmupSets: 1 }] }))
    expect(values(entry)).toEqual([[80, 10], [40, 8], [75, 7], [40, 8]])
    expect(entry.sets.filter(isWarmupRow)).toHaveLength(1)
    expect(entry.sets[0].w).toBe(40)
  })

  it('does not copy an explicitly skipped row even when old data also marks it done', () => {
    const st = state([workout([logged(80, 10), logged(200, 1, { skipped: true }), logged(75, 7)])])
    expect(values(buildSessionEntries(st, routine())[0])).toEqual([[80, 10], [40, 8], [75, 7]])
  })

  it('clears a planned warm-up ramp when the last completed load was zero', () => {
    const st = state([workout([logged(0, 10)])])
    const [entry] = buildSessionEntries(st, routine({ ex: [{ ...cfg, warmupSets: 2 }] }))
    expect(entry.sets.filter(isWarmupRow).map(s => s.w)).toEqual([0, 0])
    expect(values(entry)[0]).toEqual([0, 10])
  })

  it('prefers the same routine and falls back to another routine for a newly created one', () => {
    const st = state([workout([logged(80, 10)]), workout([logged(100, 5)], { routineIds: ['push'] })])
    expect(values(buildSessionEntries(st, routine())[0])[0]).toEqual([80, 10])
    expect(values(buildSessionEntries(st, routine({ id: 'new' }))[0])[0]).toEqual([100, 5])
  })

  it('uses entry routine ids when the same exercise appears twice in a combined workout', () => {
    const st = state([workout([], { routineIds: ['push', 'upper'], entries: [
      { id: cfg.id, rid: 'push', target: cfg, sets: [logged(100, 5)] },
      { id: cfg.id, rid: 'upper', target: cfg, sets: [logged(70, 12)] },
    ] })])
    expect(values(buildSessionEntries(st, routine())[0])[0]).toEqual([70, 12])
  })

  it('ignores excluded, invalid and mismatched-mode history', () => {
    const old = workout([logged(70, 8)])
    const deload = workout([logged(20, 8)], { excludeFromProgression: true })
    const invalid = workout([logged(NaN, 8), logged(90, 0)])
    const cardio = workout([{ min: 10, speed: 7, done: true }])
    cardio.entries[0].target = { mode: 'cardio' }
    const st = state([old, deload, invalid, cardio])
    expect(values(buildSessionEntries(st, routine())[0])[0]).toEqual([70, 8])
  })

  it('falls back to the routine values for an exercise without history', () => {
    const [entry] = buildSessionEntries(state([]), routine())
    expect(values(entry)).toEqual([[40, 8], [40, 8], [40, 8]])
    expect(entry.fromLastWorkout).toBeUndefined()
  })

  it('does not claim a previous value when only a now-removed set was completed', () => {
    const [entry] = buildSessionEntries(state([workout([logged(90, 8, { done: false }), logged(80, 10)])]),
      routine({ ex: [{ ...cfg, sets: 1 }] }))
    expect(values(entry)).toEqual([[40, 8]])
    expect(entry.fromLastWorkout).toBeUndefined()
  })

  it('copies timed and cardio values while keeping the new sets unchecked', () => {
    for (const [target, previous, expected] of [
      [{ mode: 'time', sets: 1, sec: 30, weight: 0 }, { sec: 55, w: 10, done: true }, { sec: 55, w: 10, done: false }],
      [{ mode: 'cardio', sets: 1, min: 10, speed: 5 }, { min: 22, speed: 8.5, done: true }, { min: 22, speed: 8.5, done: false }],
    ]) {
      const w = workout([previous]); w.entries[0].target = target
      const [entry] = buildSessionEntries(state([w]), routine({ ex: [{ id: cfg.id, ...target }] }))
      expect(entry.sets[0]).toMatchObject(expected)
    }
  })

  it('keeps left and right weights and reps independent', () => {
    const row = syncSideAggregate({ ...makeSideSet({ w: 20, r: 16 }), sides: { L: logged(25, 9), R: logged(22.5, 8) } })
    const [entry] = buildSessionEntries(state([workout([row])]), routine({ ex: [{ ...cfg, side: true, sets: 1 }] }))
    expect(entry.sets[0].sides).toEqual({ L: { w: 25, r: 9, done: false }, R: { w: 22.5, r: 8, done: false } })
  })

  it('never seeds an unchecked limb from a stale parent completion flag', () => {
    const partial = { w: 100, r: 20, done: true, sides: { L: logged(100, 10), R: logged(80, 10, { done: false }) } }
    const [entry] = buildSessionEntries(state([workout([partial])]), routine({ ex: [{ ...cfg, side: true, sets: 1 }] }))
    expect(entry.sets[0].sides).toEqual({ L: { w: 40, r: 4, done: false }, R: { w: 40, r: 4, done: false } })
    expect(entry.fromLastWorkout).toBeUndefined()
  })

  it('preserves left/right timed holds and the positions of unfinished holds', () => {
    const target = { id: cfg.id, mode: 'time', side: true, sec: 30, sets: 2, weight: 0 }
    const previous = workout([], { entries: [{ id: cfg.id, target, sets: [
      { side: 'L', sec: 45, w: 10, done: true }, { side: 'R', sec: 60, w: 12.5, done: false },
      { side: 'L', sec: 35, w: 7.5, done: true }, { side: 'R', sec: 40, w: 10, done: true },
    ] }] })
    const [entry] = buildSessionEntries(state([previous]), routine({ ex: [target] }))
    expect(entry.sets.map(s => [s.side, s.sec, s.w, s.done])).toEqual([
      ['L', 45, 10, false], ['R', 30, 0, false], ['L', 35, 7.5, false], ['R', 40, 10, false],
    ])
  })

  it('keeps copied rest-pause totals and rebuilds fresh bursts to agree with them', () => {
    const intensifier = { type: 'restpause', totalReps: 20, restSec: 12 }
    const st = state([workout([logged(80, 14, { type: 'restpause', clusters: [{ r: 14, restSec: 25 }] })])])
    const [entry] = buildSessionEntries(st, routine({ ex: [{ ...cfg, intensifier }] }))
    const work = entry.sets.filter(s => !isWarmupRow(s))
    expect(work).toHaveLength(1)
    expect(values(entry)).toEqual([[80, 14]])
    expect(work[0].clusters.reduce((sum, burst) => sum + burst.r, 0)).toBe(14)
    expect(work[0].clusters.every(burst => burst.restSec === 12)).toBe(true)
    expect(entry.sets.find(isWarmupRow).w).toBe(80)
  })

  it('keeps asymmetric rest-pause totals for each limb with matching new bursts', () => {
    const previous = syncSideAggregate({ ...makeSideSet({ w: 20, r: 16 }), sides: {
      L: logged(25, 9), R: logged(22.5, 6),
    } })
    const [entry] = buildSessionEntries(state([workout([previous])]), routine({ ex: [{
      ...cfg, side: true, intensifier: { type: 'restpause', totalReps: 20, restSec: 10 },
    }] }))
    const [work] = entry.sets.filter(s => !isWarmupRow(s))
    expect(work).toMatchObject({ w: 25, r: 15, done: false, sides: {
      L: { w: 25, r: 9, done: false }, R: { w: 22.5, r: 6, done: false },
    } })
    for (const side of ['L', 'R']) expect(work.sides[side].clusters.reduce((sum, burst) => sum + burst.r, 0)).toBe(work.sides[side].r)
  })

  it('rebuilds planned drops from copied loads without carrying old drops or effort', () => {
    const st = state([workout([logged(80, 10, { type: 'dropset', drops: [{ w: 10, r: 100 }] })])])
    const [entry] = buildSessionEntries(st, routine({ ex: [{ ...cfg, intensifier: { type: 'dropset', count: 1, pct: 20 } }] }))
    expect(entry.sets[0]).toMatchObject({ w: 80, r: 10, done: false, type: 'dropset' })
    expect(entry.sets[0].drops).toHaveLength(1)
    expect(entry.sets[0].drops[0].w).toBeGreaterThan(60)
    expect(entry.sets[0].drops[0].w).toBeLessThan(80)
    expect(entry.sets[0].drops[0].r).toBe(10)
  })

  it('lets a routine override the global setting and keeps deload targets prescribed', () => {
    const st = { ...state([workout([logged(80, 10), logged(80, 10), logged(80, 10)])]), startFrom: 'plan' }
    expect(values(buildSessionEntries(st, routine({ startFrom: 'lastWorkout' }))[0])[0]).toEqual([80, 10])
    const excluded = buildSessionEntries({ ...st, startFrom: 'lastWorkout' }, routine({ excludeFromProgression: true }))[0]
    expect(values(excluded)).toEqual([[40, 8], [40, 8], [40, 8]])
    expect(excluded.noProg).toBe(true)
    expect(buildSessionEntries({ ...st, startFrom: 'lastWorkout' }, routine({ startFrom: 'plan' }))[0].fromLastWorkout).toBeUndefined()
  })
})
