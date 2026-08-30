import { useState } from 'react';
import { Calendar, Check, Clock } from 'lucide-react';
import { useTranslation } from 'react-i18next';


export interface SchedulerProps {
  readonly onCancel: () => unknown;
  readonly onSchedule: (scheduledAt: Date) => unknown;
}


interface QuickScheduleOption {
  readonly hour?: number;
  readonly hours?: number;
  readonly label: string;
  readonly tomorrow?: boolean;
}


function toLocalDateString(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}


const QUICK_OPTIONS: readonly QuickScheduleOption[] = [
  { hours: 1, label: '+1 hour' },
  { hours: 3, label: '+3 hours' },
  { hour: 9, label: 'Tomorrow 9:00', tomorrow: true },
  { hour: 18, label: 'Tomorrow 18:00', tomorrow: true },
];


export default function Scheduler({ onCancel, onSchedule }: SchedulerProps) {
  const { t } = useTranslation();
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const today = toLocalDateString(new Date());

  const handleSchedule = (): void => {
    if (date && time) onSchedule(new Date(`${date}T${time}`));
  };

  const applyQuickOption = (option: QuickScheduleOption): void => {
    const now = new Date();
    const scheduled = option.tomorrow
      ? new Date(now)
      : new Date(now.getTime() + (option.hours ?? 0) * 60 * 60 * 1000);
    if (option.tomorrow) {
      scheduled.setDate(scheduled.getDate() + 1);
      scheduled.setHours(option.hour ?? 0, 0, 0, 0);
    }
    setDate(toLocalDateString(scheduled));
    setTime(scheduled.toTimeString().slice(0, 5));
  };

  return (
    <div className="bg-black/80 backdrop-blur-xl p-5 rounded-xl border border-white/10 mt-3 shadow-2xl">
      <h4 className="text-sm font-semibold mb-3 text-zinc-200 flex items-center gap-2">
        <Calendar className="text-primary" size={16} />
        <span>{t('social.scheduler_title', 'Schedule Post')}</span>
      </h4>
      <div className="flex flex-wrap gap-2 mb-4">
        {QUICK_OPTIONS.map((option) => (
          <button
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-white/5 text-zinc-400 hover:bg-primary/20 hover:text-primary transition-all border border-white/5 hover:border-primary/20"
            key={option.label}
            onClick={() => {
              applyQuickOption(option);
            }}
          >
            {option.label}
          </button>
        ))}
      </div>
      <div className="flex gap-3 mb-4">
        <div className="flex-1">
          <label className="block text-xs font-medium text-zinc-500 mb-1.5 ml-1">
            {t('common.date', 'Date')}
          </label>
          <input
            className="w-full px-3 py-2 rounded-lg border border-white/10 bg-white/5 text-zinc-200 text-sm focus:ring-2 focus:ring-primary/50 focus:border-primary/50 focus:outline-none transition-all placeholder-zinc-600"
            min={today}
            onChange={(event) => {
              setDate(event.target.value);
            }}
            type="date"
            value={date}
          />
        </div>
        <div className="flex-1">
          <label className="block text-xs font-medium text-zinc-500 mb-1.5 ml-1">
            {t('common.time', 'Time')}
          </label>
          <input
            className="w-full px-3 py-2 rounded-lg border border-white/10 bg-white/5 text-zinc-200 text-sm focus:ring-2 focus:ring-primary/50 focus:border-primary/50 focus:outline-none transition-all"
            onChange={(event) => {
              setTime(event.target.value);
            }}
            type="time"
            value={time}
          />
        </div>
      </div>
      {date && time && (
        <div className="text-xs text-zinc-400 mb-4 p-3 bg-primary/10 border border-primary/20 rounded-lg flex items-center gap-2">
          <Clock className="text-primary" size={14} />
          <span>
            {t('social.scheduler_will_publish', 'It will publish on:')}{' '}
            <strong className="text-zinc-200">
              {new Date(`${date}T${time}`).toLocaleString()}
            </strong>
          </span>
        </div>
      )}
      <div className="flex justify-end gap-2 text-sm">
        <button
          className="px-4 py-2 text-zinc-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors flex items-center gap-1"
          onClick={onCancel}
        >
          {t('common.cancel', 'Cancel')}
        </button>
        <button
          className="px-4 py-2 bg-primary hover:bg-blue-600 disabled:bg-zinc-700 disabled:text-zinc-500 text-white rounded-lg font-medium transition-all shadow-lg shadow-primary/20 flex items-center gap-1.5 transform active:scale-95"
          disabled={!date || !time}
          onClick={handleSchedule}
        >
          <Check size={16} />
          {t('social.scheduler_confirm', 'Confirm')}
        </button>
      </div>
    </div>
  );
}
