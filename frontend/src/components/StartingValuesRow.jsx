import { t } from '../lib/i18n.js'
import { startFromOf } from '../lib/session-start.js'
import { SelectRow } from './ui.jsx'

export const startingValuesLabel = value => value === 'lastWorkout' ? t('Last workout')
  : value === 'last' ? t('Last reps + progression') : t('Plan + progression')

/** A routine can override the profile's starting values without changing other routines. */
export default function StartingValuesRow({ state, routine, onChange }) {
  const options = [
    { value: 'lastWorkout', label: t('Last workout'), subtitle: t('Copy the completed weights, reps and durations from last time. No automatic increases. New or skipped sets use the routine’s values.') },
    { value: 'plan', label: t('Plan + progression'), subtitle: t('Start with your routine’s targets and apply its progression rules.') },
    { value: 'last', label: t('Last reps + progression'), subtitle: t('Carry over previous reps while progression can still change the weight or rep target.') },
  ]
  if (routine) options.unshift({ value: 'default', label: t('Use workout setting'), subtitle: startingValuesLabel(startFromOf(state)) })
  const value = routine ? (['plan', 'last', 'lastWorkout'].includes(routine.startFrom) ? routine.startFrom : 'default') : startFromOf(state)
  return <SelectRow icon="history" iconTint="var(--green)" title={t('Planned sessions start from')}
    stackedValue value={value} options={options} onChange={onChange} />
}
