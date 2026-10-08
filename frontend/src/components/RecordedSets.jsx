import { t } from '../lib/i18n.js'
import { setLabel, modeOf, isBw } from '../lib/history.js'
import { fmtNum } from '../lib/format.js'
import { hasCompletedWork, isWarmupRow, isDropSet, isRestPauseSet } from '../lib/workout-model.js'
import { KMH_PER_MPH } from '../lib/speed.js'

// Keep the canonical result formatter: it understands partial unilateral sets, drop sets,
// rest-pause bursts, bodyweight and legacy timed/cardio records without rewriting the record.
export default function RecordedSets({ entry, unit, speedUnit }) {
  const sets = (entry.sets || []).filter(hasCompletedWork)
  const target = { ...entry.target, id: entry.target?.id ?? entry.id }
  const modes = sets.map(s => {
    let mode = modeOf(target)
    if (!entry.target && !(s.r > 0)) {
      if (s.min > 0 || s.speed > 0) mode = 'cardio'
      else if (s.sec > 0) mode = 'time'
    }
    if (!['reps', 'time', 'cardio'].includes(entry.target?.mode) && s.r > 0 && !(s.min > 0 || s.speed > 0 || s.sec > 0)) mode = 'reps'
    return mode
  })
  const mode = modes[0] || modeOf(target)
  const hasWeight = sets.some(s => s.w > 0 || s.sides?.L?.w > 0 || s.sides?.R?.w > 0)
  const resultHeading = mode === 'cardio' ? `${t('Time')} / ${t('Speed')}`
    : mode === 'time' ? `${t('Time')}${hasWeight ? ` · ${unit}` : ''}`
      : isBw(target) && !hasWeight ? t('Reps') : `${t('Weight')} × ${t('Reps')} · ${unit}`
  let work = 0
  return <>
    <div className="workout-record-set-heading"><span>{t('Set')}</span><span>{modes.every(m => m === mode) ? resultHeading : t('Result')}</span></div>
    {sets.map((s, i) => {
      const warmup = isWarmupRow(s)
      const labels = [warmup && t('Warm-up'), isDropSet(s) && t('Drop set'), isRestPauseSet(s) && t('Rest-pause'), s.max && t('Max reps')].filter(Boolean)
      // Rep labels already contain recorded effort; timed/cardio labels omit it.
      if (modes[i] !== 'reps') {
        if (s.rir != null) labels.push(`RIR ${fmtNum(s.rir)}`)
        else if (s.rpe != null) labels.push(`RPE ${fmtNum(s.rpe)}`)
      }
      // Cardio stores speed and duration, so distance is derived from those recorded values.
      if (s.min > 0 && s.speed > 0) labels.push(`${t('Distance')} ${fmtNum(s.speed * s.min / 60 / (speedUnit === 'mph' ? KMH_PER_MPH : 1))} ${speedUnit === 'mph' ? 'mi' : 'km'}`)
      return <div className="workout-record-set" key={i}>
        <span className={'workout-record-set-number' + (warmup ? ' warmup' : '')} aria-label={warmup ? t('Warm-up') : t('Set {0}', work + 1)}>{warmup ? 'W' : ++work}</span>
        <div><div className="ss">{setLabel(entry.id, s, entry.target, speedUnit)}</div>
          {labels.length > 0 && <span className="workout-record-set-detail">{labels.join(' · ')}</span>}
          {s.note && <span className="workout-record-set-detail">{s.note}</span>}
        </div>
      </div>
    })}
    {!sets.length && <div className="muted small">{t('no sets')}</div>}
  </>
}
