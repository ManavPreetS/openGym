// @vitest-environment happy-dom
// A weekday with one routine read "1 routines" (QA copy): the header formatted the count
// with the plural key only, although both forms have been in every pack for a long time.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Plan from './Plan.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => {
  const state = { S: null }
  state.snapshot = () => ({
    S: state.S,
    user: null,
    update: mut => {
      const next = structuredClone(state.S)
      mut(next)
      state.S = next
    },
  })
  return state
})
vi.mock('../store/useStore.js', () => {
  const useStore = selector => (selector ? selector(mocks.snapshot()) : mocks.snapshot())
  useStore.getState = mocks.snapshot
  return { useStore, DEF: { reminder: { time: '17:30' } }, hasData: () => false }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
vi.mock('../lib/mobile.js', () => ({ MOBILE: false, isAndroid: () => Promise.resolve(false), shareExport: vi.fn(), syncReminder: vi.fn() }))
vi.mock('../sheets.jsx', () => ({
  starterPlanSheet: vi.fn(), dayAssignSheet: vi.fn(),
}))

let host, root
beforeEach(() => {
  localStorage.setItem('gym_plan_view', 'schedule')
  mocks.S = {
    unit: 'kg', workouts: [], exWeights: {}, week: {}, dayPlan: {},
    routines: [{ id: 'r1', name: 'Push', emoji: null, ex: [] }, { id: 'r2', name: 'Pull', emoji: null, ex: [] }],
  }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const mount = () => act(() => root.render(<Plan />))
// a single routine says how many exercises it has; a combined day says how many routines
const countOn = day => host.querySelector(`.plan-day[aria-label="${day}"] .ss`)?.textContent

describe('Plan — the day header counts its routines', () => {
  it('opens the routine list by default and keeps the schedule one tap away', () => {
    localStorage.removeItem('gym_plan_view')
    mount()
    expect(host.querySelector('h1').textContent).toBe('Routines')
    expect(host.querySelector('.plan-day')).toBeNull()
    expect(host.textContent).toContain('Push')
    act(() => host.querySelector('.plan-schedule-entry').click())
    expect(host.querySelector('h1').textContent).toBe('Schedule')
    expect(host.querySelector('.plan-day')).toBeTruthy()
  })

  it('names the exercises of a single routine, and counts the routines of a combined day', () => {
    mocks.S.week = { 1: ['r1'], 2: ['r1', 'r2'] }
    mount()
    expect(countOn('Monday')).toBe('0 exercises')
    expect(countOn('Tuesday')).toBe('2 routines')
  })
})
