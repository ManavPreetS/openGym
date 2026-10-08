import { useMemo, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { t, tn, dateLocale } from '../lib/i18n.js'
import { workoutDetailSheet, logPastWorkoutSheet, calendarSheet } from '../sheets.jsx'
import { Button } from '../components/ui.jsx'
import Icon from '../components/Icon.jsx'
import { EXIDX } from '../lib/exercises.js'
import { exerciseNameText, durPart, fmtDate } from '../lib/format.js'
import { workoutDay, workoutDuration } from '../lib/history.js'
import { hasCompletedWork, isWarmupRow } from '../lib/workout-model.js'
import './history.css'

const nameOf = e => EXIDX[e.id] ? exerciseNameText(EXIDX[e.id]) : e.n || e.id
const workSetCount = e => (e.sets || []).filter(s => hasCompletedWork(s) && !isWarmupRow(s)).length

function LogRow({ w }) {
  const day = workoutDay(w)
  const date = day ? new Date(day + 'T12:00:00') : null
  const entries = (w.entries || []).filter(e => (e.sets || []).some(hasCompletedWork))
  return <button className="history-row" onClick={() => workoutDetailSheet(w)}>
    <span className="history-date" aria-label={day ? fmtDate(day, true, true) : undefined}>
      <span>{date ? date.toLocaleDateString(dateLocale(), { weekday: 'short' }) : '–'}</span>
      <strong>{date ? date.toLocaleDateString(dateLocale(), { day: 'numeric' }) : '–'}</strong>
    </span>
    <span className="history-row-content">
      <span className="history-row-title"><strong>{w.name || t('Workout')}</strong><span>{durPart(workoutDuration(w)).join('')}</span></span>
      <span className="history-exercises">{entries.slice(0, 4).map((e, i) =>
        <span key={i}><span className="history-set-count">{workSetCount(e)}×</span>{nameOf(e)}</span>)}
        {entries.length > 4 && <span className="history-more">{t('+{0} more', entries.length - 4)}</span>}
      </span>
      {!!w.note && <span className="history-note">{w.note}</span>}
    </span>
    <Icon name="chevronRight" className="history-chevron" />
  </button>
}

export default function History() {
  const S = useStore(s => s.S)
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState('')
  const months = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    const workouts = [...S.workouts].filter(w => !needle || [w.name, w.note, ...(w.entries || []).map(nameOf)].filter(Boolean).some(value => value.toLocaleLowerCase().includes(needle)))
      .sort((a, b) => (workoutDay(b) || '').localeCompare(workoutDay(a) || '') || (Number(b.start) || 0) - (Number(a.start) || 0))
    const groups = new Map()
    for (const w of workouts) {
      const month = workoutDay(w)?.slice(0, 7) || ''
      if (!groups.has(month)) groups.set(month, [])
      groups.get(month).push(w)
    }
    return [...groups]
  }, [S.workouts, query])
  return <div className="history-page">
    <div className="hdr history-header">
      <div className="grow"><h1>{t('Log')}</h1><div className="sub">{tn('{0} workout', '{0} workouts', S.workouts.length)}</div></div>
      <button className="iconbtn" aria-label={t('Search workouts')} aria-expanded={searching} onClick={() => { setSearching(!searching); setQuery('') }}><Icon name="magnifier" /></button>
      <button className="iconbtn" aria-label={t('Calendar')} onClick={() => calendarSheet()}><Icon name="calendar" /></button>
      <button className="iconbtn history-add" aria-label={t('Log a past workout')} onClick={logPastWorkoutSheet}><Icon name="plus" /></button>
    </div>
    {searching && <div className="history-search"><input className="input" type="search" autoFocus aria-label={t('Search workouts')} placeholder={t('Search workouts or exercises')} value={query} onChange={e => setQuery(e.target.value)} /></div>}
    {months.map(([month, workouts]) => <section className="history-month" key={month} aria-label={month || t('History')}>
      <div className="history-month-header"><h2>{month ? new Date(month + '-01T12:00:00').toLocaleDateString(dateLocale(), { month: 'long', year: 'numeric' }) : t('History')}</h2><span>{tn('{0} workout', '{0} workouts', workouts.length)}</span></div>
      <div className="history-month-list">{workouts.map((w, i) => <LogRow key={w.id ?? `${w.d}|${w.start}|${i}`} w={w} />)}</div>
    </section>)}
    {!months.length && <div className="empty"><div className="ico"><Icon name="history" /></div>{S.workouts.length ? t('No workouts found') : t('No workouts yet. Your first one will land here.')}
      {!S.workouts.length && <Button icon="plus" onClick={logPastWorkoutSheet} style={{ marginTop: 20 }}>{t('Log a past workout')}</Button>}
    </div>}
  </div>
}
