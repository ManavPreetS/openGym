import { useRef, useState } from 'react'
import { useUI } from '../store/useUI.js'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { REST_MAX, fmtRest } from '../lib/duration.js'
import { unlock } from '../lib/sound.js'
import DurationWheel from './DurationWheel.jsx'
import { Button } from './ui.jsx'
import Icon from './Icon.jsx'

function ManualRestSheet({ close }) {
  const timer = useUI(s => s.timer)
  const work = useUI(s => s.work)
  const [seconds, setSeconds] = useState(() => Math.min(REST_MAX, Math.max(1, useStore.getState().S.restSec || 90)))
  const [presetVersion, setPresetVersion] = useState(0)
  const read = useRef(null)
  const ui = useUI.getState()
  return <div className="manual-rest-sheet">
    <h3>{t('Rest timer')}</h3>
    <p className="dim small">{t('Start a rest anytime. Automatic rest uses the same countdown.')}</p>
    {timer && <div className="manual-rest-current">
      <div className="row between">
        <span className="dim">{t(timer.ready ? 'Ready' : timer.paused ? 'Paused' : 'Rest')}</span>
        <strong>{timer.ready ? '0:00' : fmtRest(timer.left)}</strong>
      </div>
      <div className="row">
        {!timer.ready && <Button size="sm" icon={timer.paused ? 'play' : 'pause'} onClick={timer.paused ? ui.resumeRest : ui.pauseRest}>{t(timer.paused ? 'Resume' : 'Pause')}</Button>}
        <Button size="sm" icon="reset" onClick={() => { unlock(); ui.resetRest() }}>{t('Reset')}</Button>
        <Button size="sm" icon="xmark" onClick={ui.stopRest}>{t('Cancel')}</Button>
      </div>
    </div>}
    <div className="rest-presets" aria-label={t('Duration presets')}>
      {[30, 60, 90, 120, 180].map(sec => <button key={sec} type="button" className={'chip' + (seconds === sec ? ' on' : '')}
        aria-pressed={seconds === sec} onClick={() => { setSeconds(sec); setPresetVersion(v => v + 1) }}>{fmtRest(sec)}</button>)}
    </div>
    <div className="dw-read" aria-hidden="true">{fmtRest(seconds)}</div>
    {/* A preset positions both wheels immediately. A smooth move from 1:30 to 2:00 would
        otherwise let an immediate Start read the seconds halfway through that animation. */}
    <DurationWheel key={presetVersion} value={seconds} onChange={setSeconds} min={1} max={REST_MAX} readRef={read} />
    {work && <p className="dim small">{t('Finish or cancel the timed set before starting a rest.')}</p>}
    <Button variant="primary" icon="timer" disabled={!!work} onClick={() => {
      unlock()
      if (useUI.getState().startManualRest(read.current ? read.current() : seconds)) close()
    }}>{t(timer ? 'Replace timer' : 'Start timer')}</Button>
  </div>
}

export function manualRestSheet() {
  return useUI.getState().openSheet(close => <ManualRestSheet close={close} />)
}

export default function RestTimerButton() {
  const timer = useUI(s => s.timer)
  const work = useUI(s => s.work)
  return <button type="button" className={'iconbtn rest-timer-button' + (timer ? ' active' : '')}
    aria-label={t('Rest timer')} title={t('Rest timer')} disabled={!!work} onClick={manualRestSheet}>
    <Icon name="timer" />
  </button>
}
