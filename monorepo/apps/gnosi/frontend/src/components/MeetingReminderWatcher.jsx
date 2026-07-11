import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import { Bell, X, Calendar, MapPin, ChevronDown, ChevronRight, Sparkles } from 'lucide-react';

const POLL_MS = 60000;

/**
 * AI meeting notifier (Notion style).
 *
 * Global component (mounted in App.jsx). Polls `GET /api/calendar/reminders`
 * and shows a banner for each upcoming meeting with the countdown, the location and
 * the AI-generated AGENDA (collapsible). The heavy lifting (scanning,
 * dedup, AI, native macOS notification) is done by the backend; here we only render
 * what it has already produced.
 */
export default function MeetingReminderWatcher() {
    const { t } = useTranslation();
    const [reminders, setReminders] = useState([]);
    const [expanded, setExpanded] = useState({});
    const dismissedRef = useRef(new Set());
    const navigate = useNavigate();

    const fetchReminders = useCallback(async () => {
        try {
            const { data } = await axios.get('/api/calendar/reminders');
            const list = Array.isArray(data?.reminders) ? data.reminders : [];
            setReminders(list.filter((r) => r?.id && !dismissedRef.current.has(r.id)));
        } catch {
            // best-effort: if the backend doesn't respond, nothing happens
        }
    }, []);

    useEffect(() => {
        fetchReminders();
        const iv = setInterval(fetchReminders, POLL_MS);
        return () => clearInterval(iv);
    }, [fetchReminders]);

    const dismiss = useCallback(async (id) => {
        dismissedRef.current.add(id);
        setReminders((prev) => prev.filter((r) => r.id !== id));
        try {
            await axios.post(`/api/calendar/reminders/${encodeURIComponent(id)}/dismiss`);
        } catch {
            // noop
        }
    }, []);

    if (!reminders.length) return null;

    return (
        <div className="fixed bottom-4 left-4 z-[100000] flex w-[360px] max-w-[calc(100vw-2rem)] flex-col gap-2">
            {reminders.map((r) => {
                const mins = r.minutes_until ?? 0;
                const when = mins <= 0 ? t('meeting_reminder.now', 'ara') : t('meeting_reminder.in_minutes', 'en {{count}} min', { count: mins });
                const isOpen = !!expanded[r.id];
                return (
                    <div
                        key={r.id}
                        className="overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-2xl"
                    >
                        <div className="flex items-start gap-2 p-3">
                            <Bell size={18} className="mt-0.5 shrink-0 text-violet-500" />
                            <div className="min-w-0 flex-1">
                                <div className="text-xs font-medium text-violet-600 dark:text-violet-300">
                                    {t('meeting_reminder.meeting_when', 'Reunió {{when}}', { when })}
                                </div>
                                <div className="truncate font-medium">{r.title}</div>
                                {r.location && (
                                    <div className="mt-0.5 flex items-center gap-1 text-xs text-[var(--text-secondary)]">
                                        <MapPin size={12} /> <span className="truncate">{r.location}</span>
                                    </div>
                                )}
                            </div>
                            <button
                                type="button"
                                onClick={() => dismiss(r.id)}
                                aria-label={t('common.dismiss')}
                                className="rounded p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"
                            >
                                <X size={16} />
                            </button>
                        </div>

                        {r.agenda && (
                            <div className="px-3 pb-1">
                                <button
                                    type="button"
                                    onClick={() => setExpanded((p) => ({ ...p, [r.id]: !p[r.id] }))}
                                    className="flex items-center gap-1 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                                >
                                    {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                    <Sparkles size={12} className="text-violet-500" />
                                    {t('meeting_reminder.agenda', 'Ordre del dia')}
                                </button>
                                {isOpen && (
                                    <div className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-[var(--bg-secondary)] p-2 text-xs">
                                        {r.agenda}
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="flex gap-2 border-t border-[var(--border-color)] px-3 py-2">
                            <button
                                type="button"
                                onClick={() => { navigate('/calendar'); dismiss(r.id); }}
                                className="inline-flex items-center gap-1 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-700"
                            >
                                <Calendar size={14} /> {t('meeting_reminder.view_in_calendar', 'Veure al calendari')}
                            </button>
                            <button
                                type="button"
                                onClick={() => dismiss(r.id)}
                                className="rounded-lg px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"
                            >
                                {t('common.dismiss')}
                            </button>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
