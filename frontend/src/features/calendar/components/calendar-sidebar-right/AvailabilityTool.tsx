import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from '../../../../shared/notifications/toast';
import { fetchCalendarFreeBusy } from '../../../../shared/api/calendar';
import { writeClipboardText } from '../../../../shared/platform/clipboard';
import type { CalendarConfig } from './calendarTypes';
export const AvailabilityTool = ({ calendars }: {calendars: readonly CalendarConfig[]}) => {
    // Without this hook, the `t('calendar.availability....')` literals inside
    // the JSX would throw a ReferenceError when the user opened the sidebar for
    // availability → the whole sidebar would end up broken with an error toast.
    const { t } = useTranslation();
    // Default date: TODAY in local time (not `toISOString`, which is UTC and close
    // at midnight would give the previous day).
    const [date, setDate] = useState(() => {
        const d = new Date();
        const p = (n: number) => String(n).padStart(2, '0');
        return `${String(d.getFullYear())}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    });
    const [loading, setLoading] = useState(false);
    const [freeSlots, setFreeSlots] = useState<{start: string; end: string}[]>([]);

    const checkAvailability = async () => {
        const email = calendars.find(c => c.kind === 'external')?.account;
        if (!email) {
            toast.error(t('calendar.availability.no_account', "No email account is configured."));
            return;
        }

        setLoading(true);
        try {
            // Window of the chosen LOCAL day (not UTC): by parsing without `Z`, the
            // browser interprets the bounds in local time and `toISOString` converts them
            // converts to the correct UTC instant. With `...Z` the window was the
            // to UTC, shifted relative to the local day for users outside UTC
            // (e.g. UTC+2: "July 6" queried 02:00→01:59 local).
            const timeMin = new Date(`${date}T00:00:00`).toISOString();
            const timeMax = new Date(`${date}T23:59:59`).toISOString();

            const result = await fetchCalendarFreeBusy({
                calendarIds: ['primary'],
                email,
                timeMax,
                timeMin,
            });

            const busy = result.calendars?.primary?.busy || [];

            const slots = [];
            let current = new Date(`${date}T09:00:00`);
            const end = new Date(`${date}T18:00:00`);

            while (current < end) {
                const slotEnd = new Date(current.getTime() + 30 * 60000);
                const isBusy = busy.some(b => {
                    const bStart = new Date(b.start);
                    const bEnd = new Date(b.end);
                    return (current < bEnd && slotEnd > bStart);
                });

                if (!isBusy) {
                    slots.push({
                        start: current.toTimeString().substring(0, 5),
                        end: slotEnd.toTimeString().substring(0, 5)
                    });
                }
                current = slotEnd;
            }
            setFreeSlots(slots);
        } catch {
            toast.error(t('calendar.availability.query_error', "Error checking availability."));
        } finally {
            setLoading(false);
        }
    };

    const copySlotsAsText = async () => {
        if (freeSlots.length === 0) return;
        const text = `${t('calendar.availability.share_intro', "Hi! I'm available on {{date}} at these times:", { date })}\n` +
            freeSlots.map(s => `- ${s.start} ${t('calendar.availability.share_time_sep', "to")} ${s.end}`).join('\n') +
            ` \n\n${t('calendar.availability.share_outro', "Which one works best for you?")}`;
        try {
            await writeClipboardText(text);
            toast.success(t('calendar.availability.copied_success', "Times copied to clipboard!"));
        } catch {
            toast.error(t('calendar.availability.copy_error', "Couldn't copy to clipboard"));
        }
    };

    return (
        <div className="p-5 space-y-6">
            <div className="space-y-4">
                <div>
                    <label className="text-[11px] font-bold text-[var(--text-tertiary)] uppercase tracking-wider mb-2 block">{t('calendar.availability.date_label')}</label>
                    <input
                        type="date"
                        value={date}
                        onChange={(e) => { setDate(e.target.value); }}
                        className="w-full bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:ring-2 focus:ring-[var(--gnosi-primary)]/20 outline-none transition-all"
                    />
                </div>

                <div className="pt-2">
                    <button
                        onClick={() => { void checkAvailability(); }}
                        disabled={loading}
                        className="btn btn-gnosi-primary w-full"
                    >
                        {loading ? t('calendar.availability.searching') : t('calendar.availability.search_btn')}
                    </button>
                </div>
            </div>

            {freeSlots.length > 0 && (
                <div className="space-y-4 animate-in fade-in slide-in-from-top-2">
                    <div className="flex items-center justify-between">
                        <h4 className="text-[11px] font-bold text-[var(--text-tertiary)] uppercase tracking-wider">{t('calendar.availability.free_slots')}</h4>
                        <button onClick={() => { void copySlotsAsText(); }} className="text-[10px] text-[var(--gnosi-primary)] hover:underline font-bold uppercase transition-all">{t('calendar.availability.copy_text')}</button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        {freeSlots.map((s, i) => (
                            <div key={i} className="px-2 py-1.5 bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded text-[11px] text-[var(--text-primary)] font-medium text-center shadow-sm">
                                {s.start} - {s.end}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div className="pt-4 border-t border-[var(--border-primary)]">
                <p className="text-[10px] text-[var(--text-tertiary)] italic">{t('calendar.availability.sync_info')}</p>
            </div>
        </div>
    );
};
