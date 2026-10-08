// @vitest-environment happy-dom
// Read completed sessions through the real store and sheet stack. The log's dispatch tests
// alone cannot detect a missing warm-up, a lost unilateral side or an unreadable saved note.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { workoutDetailSheet } from './sheets.jsx'
import { dateLocale } from './lib/i18n.js'

const clone = value => JSON.parse(JSON.stringify(value))
const done = (w, r, rest = {}) => ({ w, r, done: true, ...rest })
const entry = (id, sets, rest = {}) => ({ id, n: id, target: { mode: 'reps', bodyweight: false }, sets, ...rest })
const workout = (entries, rest = {}) => ({
  id: 'record', d: '2026-10-06', name: 'Upper A',
  start: new Date(2026, 9, 6, 17, 15).getTime(), end: new Date(2026, 9, 6, 18, 5).getTime(),
  entries, prs: [], routineIds: [], vol: 1120, ...rest,
})
let root, host
async function renderRecord(w, profile = {}) {
  useStore.setState({ S: { ...clone(DEF), unit: 'kg', workouts: [w], active: null, ...profile }, user: null })
  act(() => workoutDetailSheet(w))
  const sheet = useUI.getState().sheets.at(-1)
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return host
}
const results = el => [...el.querySelectorAll('.workout-record-set .ss')].map(row => row.textContent)
const meta = () => Object.fromEntries([...host.querySelectorAll('.workout-record-meta>div')].map(row => [row.querySelector('dt').textContent, row.querySelector('dd').textContent]))
const type = (el, text) => {
  Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, text)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useUI.setState({ sheets: [], toast: vi.fn() })
})
afterEach(() => {
  if (root) act(() => root.unmount())
  root = null
  document.body.innerHTML = ''
})

describe('completed workout record', () => {
  it('shows each completed set with warm-up/working numbers, notes, effort and session metadata', async () => {
    const w = workout([entry('Deleted custom bench', [
      done(20, 12, { phase: 'warmup' }),
      done(70, 8, { rir: 2, note: 'Two second pause' }),
      done(70, 8, { rpe: 9 }),
      done(999, 99, { done: false }),
    ], { note: 'Seat position 3', notePin: true })], { bw: 74.3, note: 'Felt strong today' })
    const original = clone(w)
    await renderRecord(w)
    expect(host.querySelector('h3').textContent).toBe('Upper A')
    expect(host.querySelector('.workout-record-ex-title').textContent.trim()).toBe('Deleted custom bench')
    expect(results(host)).toEqual(['20×12', '70×8 (RIR 2)', '70×8 (RPE 9)'])
    expect([...host.querySelectorAll('.workout-record-set-number')].map(n => n.textContent)).toEqual(['W', '1', '2'])
    expect(host.textContent).toContain('Warm-up')
    expect(host.textContent).toContain('Two second pause')
    expect(host.querySelector('.workout-record-ex-note').textContent).toBe('Seat position 3')
    expect(host.querySelector('.workout-record-note').textContent).toContain('Felt strong today')
    expect(host.textContent).not.toContain('999')
    const time = timestamp => new Date(timestamp).toLocaleTimeString(dateLocale(), { hour: 'numeric', minute: '2-digit' })
    expect(meta()).toEqual({ 'Start time': time(w.start), 'End time': time(w.end), 'Body weight': '74.3 kg' })
    expect(host.querySelector('.workout-record-facts').textContent).toContain('Duration50 min')
    expect(host.querySelector('.workout-record-facts').textContent).toContain('Sets3')
    expect(useStore.getState().S.workouts[0]).toEqual(original)
  })

  it('keeps management controls collapsed and saves a note edited in Workout options', async () => {
    await renderRecord(workout([entry('Bench', [done(60, 8)])], { note: 'Original note' }))
    const options = host.querySelector('details.workout-record-options')
    expect(options.open).toBe(false)
    expect(options.querySelector('summary').textContent).toBe('Workout options')
    const controls = [...options.querySelectorAll('button')].map(b => b.textContent.trim())
    expect(controls).toEqual(expect.arrayContaining(['Edit workout', 'Repeat today', 'Change date & time', 'Change duration', 'Save as routine', 'Copy as text', 'Delete workout']))
    act(() => options.querySelector('summary').click())
    expect(options.open).toBe(true)
    const note = options.querySelector('textarea')
    act(() => type(note, 'New session note'))
    expect(host.querySelector('.workout-record-note').textContent).toContain('New session note')
    // Dismissal also flushes the draft, even without a textarea blur.
    act(() => root.unmount())
    root = null
    expect(useStore.getState().S.workouts[0].note).toBe('New session note')
  })

  it('labels timed and bodyweight results correctly and retains timed effort', async () => {
    await renderRecord(workout([
      entry('Weighted hold', [{ done: true, sec: 45, w: 10, rir: 0 }], { target: { mode: 'time' } }),
      entry('Push-ups', [done(0, 15)], { target: { mode: 'reps', bodyweight: true } }),
      entry('Legacy plank', [{ done: true, sec: 90, w: 0, rpe: 8 }], { target: undefined }),
    ]))
    const cards = [...host.querySelectorAll('.wd-ex')]
    expect(cards.map(card => card.querySelector('.workout-record-set-heading').textContent)).toEqual(['SetTime · kg', 'SetReps', 'SetTime'])
    expect(results(host)).toEqual(['0:45 · 10', '15', '1:30'])
    expect(cards[0].textContent).toContain('RIR 0')
    expect(cards[2].textContent).toContain('RPE 8')
  })

  it.each([
    ['kg', 'kmh', '30 min @ 9.7 km/h', 'Distance 4.8 km'],
    ['lb', 'mph', '30 min @ 6 mph', 'Distance 3 mi'],
  ])('shows cardio in the %s profile speed units without a weight header', async (unit, speedUnit, result, distance) => {
    const w = workout([entry('Treadmill', [{ done: true, min: 30, speed: 9.656064, rpe: 8 }], { target: { mode: 'cardio' } })])
    await renderRecord(w, { unit, speedUnit })
    expect(host.querySelector('.workout-record-set-heading').textContent).toBe('SetTime / Speed')
    expect(results(host)).toEqual([result])
    expect(host.querySelector('.workout-record-set').textContent).toContain(distance)
    expect(host.querySelector('.workout-record-set').textContent).toContain('RPE 8')
    expect(useStore.getState().S.workouts[0].entries[0].sets[0].speed).toBe(9.656064)
  })

  it('retains unilateral asymmetry and partial completion, drops and rest-pause bursts', async () => {
    await renderRecord(workout([
      entry('One-arm row', [
        { done: true, w: 22, r: 15, sides: { L: done(22, 8, { rir: 1 }), R: done(20, 7, { rir: 2 }) } },
        { done: false, w: 22, r: 14, sides: { L: done(22, 8), R: done(999, 6, { done: false }) } },
        { done: false, w: 999, r: 12, sides: { L: done(999, 6, { done: false }), R: done(999, 6, { done: false }) } },
      ], { target: { mode: 'reps', perSide: true } }),
      entry('Press', [done(100, 8, { type: 'dropset', drops: [{ w: 80, r: 6 }, { w: 60, r: 5 }] })]),
      entry('Curl', [done(60, 16, { type: 'restpause', clusters: [{ r: 4, restSec: 15 }, { r: 2, restSec: 15 }] })]),
    ]))
    expect(results(host)).toEqual(['L 22×8 (RIR 1) · R 20×7 (RIR 2)', 'L 22×8 · R –', '100×8 ↘ 80×6 ↘ 60×5', '60×10+4+2'])
    expect(host.querySelectorAll('.workout-record-set')).toHaveLength(4)
    expect(host.textContent).not.toContain('999')
    expect(host.textContent).toContain('Drop set')
    expect(host.textContent).toContain('Rest-pause')
  })
})
