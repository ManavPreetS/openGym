// @vitest-environment happy-dom
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { DEF, useStore } from '../store/useStore.js'
import { workoutDetailSheet, logPastWorkoutSheet, calendarSheet } from '../sheets.jsx'
import History from './History.jsx'

vi.mock('../sheets.jsx', () => ({ workoutDetailSheet: vi.fn(), logPastWorkoutSheet: vi.fn(), calendarSheet: vi.fn() }))
const done = (w = 50, r = 8, extra = {}) => ({ w, r, done: true, ...extra })
const entry = (n, sets = [done()]) => ({ id: 'deleted-' + n, n, sets })
const workout = (id, d, name, extra = {}) => ({ id, d, name, start: new Date(d + 'T17:00:00').getTime(), end: new Date(d + 'T18:00:00').getTime(), entries: [entry('Bench press')], ...extra })
let root, host
const render = workouts => {
  useStore.setState({ S: { ...JSON.parse(JSON.stringify(DEF)), workouts } })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root.render(<History />))
  return host
}
const button = label => host.querySelector(`button[aria-label="${label}"]`)
const search = query => act(() => {
  const input = host.querySelector('input[type=search]')
  Object.getOwnPropertyDescriptor(input.constructor.prototype, 'value').set.call(input, query)
  input.dispatchEvent(new Event('input', { bubbles: true }))
})

beforeEach(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; vi.clearAllMocks() })
afterEach(() => { if (root) act(() => root.unmount()); document.body.innerHTML = '' })

describe('workout log', () => {
  it('groups by the workout calendar month and sorts dates and same-day sessions newest first', () => {
    const morning = workout('early', '2026-10-06', 'Morning', { start: new Date('2026-10-06T09:00:00').getTime(), end: new Date('2026-10-06T10:00:00').getTime() })
    render([workout('latest', '2026-10-07', 'Upper A'), morning, workout('older', '2026-09-30', 'Legs'), workout('late', '2026-10-06', 'Evening')])
    expect([...host.querySelectorAll('.history-month-header h2')].map(h => h.textContent)).toEqual(['October 2026', 'September 2026'])
    expect([...host.querySelectorAll('.history-row-title strong')].map(h => h.textContent)).toEqual(['Upper A', 'Evening', 'Morning', 'Legs'])
    expect(host.querySelector('.history-month-header').textContent).toContain('3 workouts')
  })

  it('previews completed exercise names and working sets, retaining deleted custom names', () => {
    render([workout('w', '2026-10-06', 'Upper', { entries: [entry('My machine', [done(20, 10, { phase: 'warmup' }), done(), done(), { done: false, w: 100, r: 1 }]), entry('Unused', [{ done: false }])] })])
    expect(host.querySelector('.history-exercises').textContent).toBe('2×My machine')
    expect(host.querySelector('.history-row-title').textContent).toContain('1h 0m')
  })

  it('opens the full original record and keeps its set details intact', () => {
    const w = workout('w', '2026-10-06', 'Upper', { note: 'Good session', entries: [entry('Bench', [done(60, 7, { rir: 2, note: 'Paused reps' })])] })
    render([w])
    act(() => host.querySelector('.history-row').click())
    expect(workoutDetailSheet).toHaveBeenCalledWith(w)
    expect(w.entries[0].sets[0]).toMatchObject({ w: 60, r: 7, rir: 2, note: 'Paused reps' })
  })

  it('searches names, notes and exercises beyond the visible preview, and clears when closed', () => {
    const hiddenExercise = workout('w', '2026-10-06', 'Upper', { entries: ['A', 'B', 'C', 'D', 'Pullover'].map(n => entry(n)) })
    render([hiddenExercise, workout('other', '2026-09-30', 'Lower', { note: 'Deload week' })])
    expect(host.textContent).toContain('+1 more')
    expect(host.textContent).not.toContain('Pullover')
    act(() => button('Search workouts').click())
    search('pullover')
    expect(host.querySelectorAll('.history-row')).toHaveLength(1)
    expect(host.querySelector('.history-row-title').textContent).toContain('Upper')
    search('DELOAD')
    expect(host.querySelectorAll('.history-row')).toHaveLength(1)
    expect(host.querySelector('.history-row-title').textContent).toContain('Lower')
    search('missing')
    expect(host.textContent).toContain('No workouts found')
    act(() => button('Search workouts').click())
    expect(host.querySelector('input[type=search]')).toBeNull()
    expect(host.querySelectorAll('.history-row')).toHaveLength(2)
  })

  it('keeps imported unknown durations empty and supports legacy records without an id', () => {
    render([workout(undefined, '2026-10-06', 'Imported', { start: 0, end: 0 }), workout(undefined, '2026-10-05', 'Older', { start: 0, end: 0 })])
    expect(host.querySelectorAll('.history-row')).toHaveLength(2)
    expect(host.querySelector('.history-row-title>span').textContent).toBe('')
  })

  it('has clear empty, add and calendar actions', () => {
    render([])
    expect(host.textContent).toContain('No workouts yet. Your first one will land here.')
    act(() => button('Log a past workout').click())
    expect(logPastWorkoutSheet).toHaveBeenCalledTimes(1)
    act(() => button('Calendar').click())
    expect(calendarSheet).toHaveBeenCalledTimes(1)
  })
})
