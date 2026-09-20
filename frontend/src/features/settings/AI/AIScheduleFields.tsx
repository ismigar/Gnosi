import { useTranslation } from 'react-i18next';

import type { CalendarSchedule } from './aiSchedule';

export function ScheduleFields({ schedule, onChange }: { readonly schedule: CalendarSchedule; readonly onChange: (value: CalendarSchedule) => void }) {
    const { t, i18n } = useTranslation();
    return <div className="ai-resource-editor__grid ai-schedule-fields">
        <label><span>{t('activity.frequency')}</span><select className="gnosi-select" value={schedule.kind} onChange={event => { onChange({ ...schedule, kind: event.target.value as CalendarSchedule['kind'] }); }}>
            {(['interval', 'daily', 'weekly'] as const).map(value => <option key={value} value={value}>{t(`activity.schedule_${value}`)}</option>)}
        </select></label>
        {schedule.kind !== 'interval' && <>
            <label><span>{t('activity.time')}</span><input className="gnosi-input" type="time" value={schedule.time} onChange={event => { onChange({ ...schedule, time: event.target.value }); }} /></label>
            <label><span>{t('activity.timezone')}</span><input className="gnosi-input" value={schedule.timezone} onChange={event => { onChange({ ...schedule, timezone: event.target.value }); }} /></label>
            <p className="ai-schedule-fields__help">{t('activity.dst_help')}</p>
        </>}
        {schedule.kind === 'weekly' && <fieldset><legend>{t('activity.weekdays')}</legend>{[0, 1, 2, 3, 4, 5, 6].map(day => <label key={day}>
            <input type="checkbox" checked={schedule.weekdays.includes(day)} onChange={event => { onChange({ ...schedule, weekdays: event.target.checked ? [...schedule.weekdays, day] : schedule.weekdays.filter(value => value !== day) }); }} />
            {new Date(Date.UTC(2024, 0, 1 + day)).toLocaleDateString(i18n.resolvedLanguage, { weekday: 'long', timeZone: 'UTC' })}
        </label>)}</fieldset>}
    </div>;
}
