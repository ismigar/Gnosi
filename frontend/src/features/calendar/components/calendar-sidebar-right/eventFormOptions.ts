import type { TFunction } from 'i18next';
export function eventFormOptions(t: TFunction) {
    const RSVP_META = {
        accepted:    { label: t('calendar.rsvp_accepted', "✓ Accepted"),  dot: 'bg-green-500',  btn: 'border-green-500 text-green-600 hover:bg-green-50 dark:hover:bg-green-950',  activeCls: 'bg-green-500 text-white border-green-500' },
        declined:    { label: t('calendar.rsvp_declined', "✗ Declined"),  dot: 'bg-red-500',    btn: 'border-red-500 text-red-600 hover:bg-red-50 dark:hover:bg-red-950',          activeCls: 'bg-red-500 text-white border-red-500' },
        tentative:   { label: t('calendar.rsvp_maybe', "? Maybe"),      dot: 'bg-amber-400',  btn: 'border-amber-400 text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950',  activeCls: 'bg-amber-400 text-white border-amber-400' },
        needsAction: { label: t('calendar.rsvp_pending', "Pending"),     dot: 'bg-gray-400',   btn: '', activeCls: '' },
    };

    const REMINDER_OPTIONS = [
        { value: '', label: t('calendar.option_none', "None") },
        { value: '5', label: t('calendar.reminder_5min', "5 minutes before") },
        { value: '15', label: t('calendar.reminder_15min', "15 minutes before") },
        { value: '30', label: t('calendar.reminder_30min', "30 minutes before") },
        { value: '60', label: t('calendar.reminder_1h', "1 hour before") },
        { value: '1440', label: t('calendar.reminder_1d', "1 day before") },
    ];

    const TRAVEL_TIME_OPTIONS = [
        { value: '', label: t('calendar.option_none', "None") },
        { value: '5', label: t('calendar.travel_5min', '5 min') },
        { value: '10', label: t('calendar.travel_10min', '10 min') },
        { value: '15', label: t('calendar.travel_15min', '15 min') },
        { value: '30', label: t('calendar.travel_30min', '30 min') },
        { value: '45', label: t('calendar.travel_45min', '45 min') },
        { value: '60', label: t('calendar.travel_1h', "1 hour") },
        { value: '90', label: t('calendar.travel_1h30', '1 h 30 min') },
        { value: '120', label: t('calendar.travel_2h', "2 hours") },
    ];

    const RECURRENCE_OPTIONS = [
        { value: '', label: t('calendar.recurrence_none', "Does not repeat") },
        { value: 'DAILY', label: t('calendar.recurrence_daily', "Every day") },
        { value: 'WEEKLY', label: t('calendar.recurrence_weekly', "Every week") },
        { value: 'MONTHLY', label: t('calendar.recurrence_monthly', "Every month") },
        { value: 'YEARLY', label: t('calendar.recurrence_yearly', "Every year") },
    ];

    const DAYS_OF_WEEK = [
        { value: 'MO', label: t('calendar.day_mo', "Mon") },
        { value: 'TU', label: t('calendar.day_tu', "Tue") },
        { value: 'WE', label: t('calendar.day_we', "Wed") },
        { value: 'TH', label: t('calendar.day_th', "Thu") },
        { value: 'FR', label: t('calendar.day_fr', "Fri") },
        { value: 'SA', label: t('calendar.day_sa', "Sat") },
        { value: 'SU', label: t('calendar.day_su', "Sun") },
    ];


 return {RSVP_META, REMINDER_OPTIONS, TRAVEL_TIME_OPTIONS, RECURRENCE_OPTIONS, DAYS_OF_WEEK};
}
