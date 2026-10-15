import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import type { BookingSchedule } from '../../shared/api/booking';
import { GnosiToggle } from '../../shared/ui/settings/SettingsPrimitives';
import { calendarKey, type CalendarChoice } from './bookingModel';

export const bookingInputClass = 'w-full bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)]';

export function BookingScheduleFields({ choices, value, onChange }: {
  choices: readonly CalendarChoice[]; value: BookingSchedule; onChange: (value: BookingSchedule) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const setNumber = (key: 'duration_minutes' | 'buffer_minutes' | 'notice_minutes' | 'horizon_days', input: string) => {
    onChange({ ...value, [key]: Number(input) });
  };
  return <div className="space-y-4">
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{t('booking.calendars', 'Check these calendars')}</legend>
      {choices.map(choice => {
        const selected = value.calendars.some(calendar => calendarKey(calendar) === choice.key);
        return <div key={choice.key} className="flex items-center justify-between gap-3 text-xs">
          <span className="break-all">{choice.label}</span>
          <GnosiToggle active={selected} label={choice.label} disabled={!selected && value.calendars.length >= 20} onChange={() => {
            onChange({ ...value, calendars: selected ? value.calendars.filter(calendar => calendarKey(calendar) !== choice.key) : [...value.calendars, choice.calendar] });
          }} />
        </div>;
      })}
    </fieldset>
    <label className="block text-xs" htmlFor={`${id}-timezone`}>{t('booking.timezone', 'Timezone')}
      <input id={`${id}-timezone`} className={bookingInputClass} value={value.timezone} onChange={event => { onChange({ ...value, timezone: event.target.value }); }} required />
    </label>
    <fieldset>
      <legend className="text-xs mb-2">{t('booking.weekdays', 'Available weekdays')}</legend>
      <div className="flex flex-wrap gap-2">{Array.from({ length: 7 }, (_, day) => <button key={day} type="button" className={`btn btn-sm ${value.weekdays?.includes(day) ? 'btn-gnosi-primary' : ''}`} aria-pressed={value.weekdays?.includes(day)} onClick={() => {
        const days = value.weekdays ?? [];
        onChange({ ...value, weekdays: days.includes(day) ? days.filter(item => item !== day) : [...days, day].sort() });
      }}>{t(`booking.weekday${String(day)}`)}</button>)}</div>
    </fieldset>
    <div className="grid grid-cols-2 gap-3">
      <label className="text-xs" htmlFor={`${id}-from`}>{t('booking.from', 'From')}
        <input id={`${id}-from`} type="time" className={bookingInputClass} value={value.working_start} onChange={event => { onChange({ ...value, working_start: event.target.value }); }} required />
      </label>
      <label className="text-xs" htmlFor={`${id}-until`}>{t('booking.until', 'Until')}
        <input id={`${id}-until`} type="time" className={bookingInputClass} value={value.working_end} onChange={event => { onChange({ ...value, working_end: event.target.value }); }} required />
      </label>
      <label className="text-xs" htmlFor={`${id}-duration`}>{t('booking.duration', 'Duration (minutes)')}
        <input id={`${id}-duration`} type="number" min="5" max="480" className={bookingInputClass} value={value.duration_minutes} onChange={event => { setNumber('duration_minutes', event.target.value); }} required />
      </label>
      <label className="text-xs" htmlFor={`${id}-buffer`}>{t('booking.buffer', 'Buffer (minutes)')}
        <input id={`${id}-buffer`} type="number" min="0" max="180" className={bookingInputClass} value={value.buffer_minutes} onChange={event => { setNumber('buffer_minutes', event.target.value); }} required />
      </label>
      <label className="text-xs" htmlFor={`${id}-notice`}>{t('booking.notice', 'Minimum notice (minutes)')}
        <input id={`${id}-notice`} type="number" min="0" max="20160" className={bookingInputClass} value={value.notice_minutes} onChange={event => { setNumber('notice_minutes', event.target.value); }} required />
      </label>
      <label className="text-xs" htmlFor={`${id}-horizon`}>{t('booking.horizon', 'Days ahead')}
        <input id={`${id}-horizon`} type="number" min="1" max="90" className={bookingInputClass} value={value.horizon_days} onChange={event => { setNumber('horizon_days', event.target.value); }} required />
      </label>
    </div>
  </div>;
}
