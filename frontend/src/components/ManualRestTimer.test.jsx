// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import RestTimerButton from './ManualRestTimer.jsx'
import RestTimer, { applyRestLeft } from './RestTimer.jsx'
import Workout from '../views/Workout.jsx'
import { useUI } from '../store/useUI.js'
import { DEF, useStore } from '../store/useStore.js'

vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})) }))
vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), chime: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn(), unlock: vi.fn() }))
globalThis.IS_REACT_ACT_ENVIRONMENT = true
let roots, hosts, original
const mount = element => {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  roots.push(root); hosts.push(host)
  act(() => root.render(element))
  return host
}
const sheet = () => {
  const top = useUI.getState().sheets.at(-1)
  return mount(top.render(() => useUI.getState().closeSheet(top.id)))
}
const click = (host, label) => act(() => {
  const button = [...host.querySelectorAll('button')].find(b => b.textContent.trim() === label || b.getAttribute('aria-label') === label)
  expect(button, label).toBeTruthy()
  button.click()
})
beforeEach(() => {
  vi.useFakeTimers()
  original = { S: useStore.getState().S, user: useStore.getState().user }
  useStore.setState({ S: structuredClone(DEF), user: null })
  useUI.getState().stopRest(); useUI.getState().stopWork()
  useUI.setState({ sheets: [], toastMsg: '' })
  roots = []; hosts = []
})
afterEach(() => {
  act(() => roots.forEach(root => root.unmount()))
  hosts.forEach(host => host.remove())
  useUI.getState().stopRest(); useUI.getState().stopWork()
  useUI.setState({ sheets: [] })
  useStore.setState(original)
  vi.useRealTimers()
})

describe('manual rest controls', () => {
  it('starts from a preset and a custom duration without a workout or a logged set', () => {
    const host = mount(<><RestTimerButton /><RestTimer /></>)
    click(host, 'Rest timer')
    expect(useUI.getState().timer).toBeNull()
    const controls = sheet()
    click(controls, '2:00')
    act(() => controls.querySelector('[aria-label="Seconds"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })))
    click(controls, 'Start timer')
    expect(useUI.getState().timer).toMatchObject({ kind: 'manual', left: 121, total: 121 })
    expect(useStore.getState().S.active).toBeNull()
    expect(useUI.getState().sheets).toHaveLength(0)
    expect(host.querySelector('#timer .t').textContent).toBe('2:01')
    expect(host.querySelector('.rest-timer-button').classList.contains('active')).toBe(true)
  })

  it('manages the existing automatic rest: pause, resume, reset and cancel', () => {
    act(() => useUI.getState().startRest(90, 2, { forSet: 1 }))
    const host = mount(<RestTimerButton />)
    click(host, 'Rest timer')
    const controls = sheet()
    act(() => vi.advanceTimersByTime(20_000))
    click(controls, 'Pause')
    act(() => vi.advanceTimersByTime(30_000))
    expect(useUI.getState().timer.left).toBe(70)
    click(controls, 'Resume')
    act(() => vi.advanceTimersByTime(10_000))
    expect(useUI.getState().timer.left).toBe(60)
    click(controls, 'Reset')
    expect(useUI.getState().timer).toMatchObject({ total: 90, left: 90, forIdx: 2, forSet: 1 })
    click(controls, 'Cancel')
    expect(useUI.getState().timer).toBeNull()
  })

  it('starts a preset exactly even when smooth wheel positioning would still be in flight', () => {
    const scroll = vi.spyOn(HTMLElement.prototype, 'scrollTo').mockImplementation(function (options) {
      // A real browser animates a changed value: Start reads the wheel's current position.
      this.scrollTop = options.behavior === 'smooth' ? (this.scrollTop + options.top) / 2 : options.top
    })
    try {
      const host = mount(<RestTimerButton />)
      click(host, 'Rest timer')
      const controls = sheet()
      click(controls, '2:00'); click(controls, 'Start timer')
      expect(useUI.getState().timer.left).toBe(120)
      expect(scroll.mock.calls.some(([options]) => options.behavior === 'smooth')).toBe(false)
    } finally { scroll.mockRestore() }
  })

  it('replaces an automatic rest with one manual countdown', () => {
    act(() => useUI.getState().startRest(60, 2))
    const host = mount(<RestTimerButton />)
    click(host, 'Rest timer')
    const controls = sheet()
    click(controls, '3:00'); click(controls, 'Replace timer')
    expect(useUI.getState().timer).toMatchObject({ kind: 'manual', left: 180, total: 180 })
    expect(useUI.getState().timer.forIdx).toBeUndefined()
  })

  it('protects a timed set started while the sheet was open', () => {
    const host = mount(<RestTimerButton />)
    click(host, 'Rest timer')
    const controls = sheet()
    act(() => useUI.getState().startWork(45, 'Plank', vi.fn()))
    expect(host.querySelector('button').disabled).toBe(true)
    expect([...controls.querySelectorAll('button')].find(b => b.textContent === 'Start timer').disabled).toBe(true)
    expect(useUI.getState().startManualRest(60)).toBe(false)
    expect(useUI.getState().work.left).toBe(45)
    expect(useUI.getState().timer).toBeNull()
  })

  it('keeps the manual origin when adjusting a completed timer', () => {
    act(() => useUI.getState().startManualRest(1))
    act(() => vi.advanceTimersByTime(1000))
    expect(useUI.getState().timer.ready).toBe(true)
    act(() => applyRestLeft(30))
    expect(useUI.getState().timer).toMatchObject({ kind: 'manual', left: 30 })
  })

  it('offers the timer in a compact workout and logging a set replaces it', () => {
    const S = structuredClone(DEF)
    S.active = { id: 'timer-workout', name: 'Upper A', start: Date.now(), d: '2026-10-07', cur: 0,
      entries: [{ id: '0001', target: { sets: 2, reps: 5 }, sets: [{ w: 20, r: 5, done: false }, { w: 20, r: 5, done: false }] }] }
    useStore.setState({ S })
    const host = mount(<MemoryRouter><Workout /></MemoryRouter>)
    expect(host.querySelector('.workout-focus')).toBeTruthy()
    expect(host.querySelector('.setrow .stp button')).toBeNull()
    expect([...host.querySelectorAll('button')].some(b => b.textContent === 'Add session note')).toBe(false)
    click(host, 'Rest timer')
    const controls = sheet()
    click(controls, 'Start timer')
    expect(useUI.getState().timer.kind).toBe('manual')
    act(() => host.querySelector('[role="checkbox"]').click())
    expect(useStore.getState().S.active.entries[0].sets[0].done).toBe(true)
    expect(useUI.getState().timer).toMatchObject({ left: 90, forIdx: 0, forSet: 0 })
    expect(useUI.getState().timer.kind).toBeUndefined()
  })
})
