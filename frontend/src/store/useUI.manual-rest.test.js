// @vitest-environment happy-dom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})) }))
vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), chime: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn() }))
import { api } from '../lib/api.js'
import { chime } from '../lib/sound.js'
import { useUI, restoreRest, REST_KEY } from './useUI.js'
import { useStore } from './useStore.js'

let original
beforeEach(() => {
  vi.useFakeTimers()
  original = { S: useStore.getState().S, user: useStore.getState().user }
  useStore.setState({ S: { ...original.S, active: null }, user: null })
  useUI.getState().stopRest(); useUI.getState().stopWork()
  localStorage.clear(); api.mockClear(); chime.mockClear()
})
afterEach(async () => {
  useUI.getState().stopRest(); useUI.getState().stopWork()
  await vi.advanceTimersByTimeAsync(0)
  useStore.setState(original)
  vi.useRealTimers()
})
const reload = () => {
  const saved = localStorage.getItem(REST_KEY)
  useUI.getState().stopRest()
  localStorage.setItem(REST_KEY, saved)
  return restoreRest()
}

describe('manual timer lifecycle and push scheduling', () => {
  it('restores outside a workout, completes once and clears its saved state', () => {
    useUI.getState().startManualRest(40)
    vi.advanceTimersByTime(10_000)
    expect(reload()).toBe(true)
    expect(useUI.getState().timer).toMatchObject({ left: 30, kind: 'manual' })
    vi.advanceTimersByTime(35_000)
    expect(useUI.getState().timer.ready).toBe(true)
    expect(chime).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem(REST_KEY)).toBeNull()
  })

  it('restores paused without an active workout, and reset preserves its origin', () => {
    useUI.getState().startManualRest(60)
    vi.advanceTimersByTime(10_000)
    useUI.getState().pauseRest()
    expect(reload()).toBe(true)
    vi.advanceTimersByTime(60_000)
    expect(useUI.getState().timer).toMatchObject({ left: 50, paused: true, kind: 'manual' })
    useUI.getState().resetRest()
    expect(useUI.getState().timer).toMatchObject({ left: 60, kind: 'manual' })
    expect(useUI.getState().timer.paused).toBeUndefined()
  })

  it('rejects invalid durations and clamps long durations to fifteen minutes', () => {
    for (const seconds of [0, -1, NaN, Infinity]) expect(useUI.getState().startManualRest(seconds)).toBe(false)
    expect(useUI.getState().timer).toBeNull()
    useUI.getState().startManualRest(2000)
    expect(useUI.getState().timer.total).toBe(900)
  })

  it('orders replacement requests behind an in-flight request and uses the actual deadline', async () => {
    useStore.setState({ user: { id: 'timer-user' } })
    let release
    api.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    useUI.getState().startManualRest(90)
    await vi.advanceTimersByTimeAsync(0)
    useUI.getState().startRest(120, 0, { forSet: 1 })
    await vi.advanceTimersByTimeAsync(5000)
    expect(api).toHaveBeenCalledTimes(1)
    release({})
    await vi.advanceTimersByTimeAsync(0)
    expect(api.mock.calls.map(([url]) => url)).toEqual(['/api/push/rest-timer', '/api/push/rest-timer/cancel', '/api/push/rest-timer'])
    expect(JSON.parse(api.mock.calls[2][1].body)).toMatchObject({ seconds: 115, deviceId: expect.any(String) })
    useUI.getState().stopRest()
    await vi.advanceTimersByTimeAsync(0)
    expect(api.mock.calls.at(-1)[0]).toBe('/api/push/rest-timer/cancel')
  })

  it('does not schedule a delayed request after its countdown has expired', async () => {
    useStore.setState({ user: { id: 'timer-user' } })
    let release
    api.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    useUI.getState().startManualRest(1)
    await vi.advanceTimersByTimeAsync(0)
    useUI.getState().startManualRest(2)
    await vi.advanceTimersByTimeAsync(3000)
    release({})
    await vi.advanceTimersByTimeAsync(0)
    expect(api.mock.calls.slice(1).every(([url]) => url.endsWith('/cancel'))).toBe(true)
  })
})
