import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Calendar, Bell } from 'lucide-react';
import i18n from '../../i18n';

/**
 * DateMentionInline
 * Notion-style inline date mention. Shows the formatted date and, if there is a
 * reminder time, a small bell. Clicking opens a popover to edit the
 * date and (optionally) the reminder time.
 *
 * Saved to Markdown as `@2026-06-25` (date) or `@2026-06-25T09:00` (with
 * reminder). Safe token: starts with a digit, so it doesn't collide with
 * `@key` citations (which require a letter after the @).
 */

const fmtDate = (iso) => {
    if (!iso) return i18n.t('common.date', 'Data');
    try {
        const d = new Date(iso + (iso.length === 10 ? 'T00:00:00' : ''));
        return new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'long', year: 'numeric' }).format(d);
    } catch { return iso; }
};

export default function DateMentionInline({ inlineContent, updateInlineContent }) {
    const { t } = useTranslation();
    const date = String(inlineContent?.props?.date || '').trim();
    const time = String(inlineContent?.props?.time || '').trim();
    const [open, setOpen] = useState(false);
    const [draftDate, setDraftDate] = useState(date);
    const [draftTime, setDraftTime] = useState(time);
    const chipRef = useRef(null);
    const popRef = useRef(null);
    const [coords, setCoords] = useState(null);

    useEffect(() => { setDraftDate(date); setDraftTime(time); }, [date, time]);

    useLayoutEffect(() => {
        if (!open || !chipRef.current) return;
        const r = chipRef.current.getBoundingClientRect();
        setCoords({ top: r.bottom + 6, left: Math.min(r.left, window.innerWidth - 280) });
    }, [open]);

    const save = useCallback(() => {
        try {
            updateInlineContent({ type: 'dateref', props: { date: draftDate, time: draftTime } });
        } catch { /* noop */ }
        setOpen(false);
    }, [draftDate, draftTime, updateInlineContent]);

    useEffect(() => {
        if (!open) return undefined;
        const onDown = (e) => {
            if (popRef.current?.contains(e.target) || chipRef.current?.contains(e.target)) return;
            save();
        };
        document.addEventListener('mousedown', onDown, true);
        return () => document.removeEventListener('mousedown', onDown, true);
    }, [open, save]);

    return (
        <span className="bn-dateref">
            <span
                ref={chipRef}
                contentEditable={false}
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((v) => !v); }}
                title={time ? t('editor.date_reminder_tooltip', 'Recordatori: {{date}} a les {{time}}', { date: fmtDate(date), time }) : fmtDate(date)}
                className="mx-0.5 inline-flex cursor-pointer select-none items-center gap-1 rounded px-1.5 py-0.5 text-sm text-[var(--gnosi-primary)] bg-[var(--gnosi-primary)]/8 hover:bg-[var(--gnosi-primary)]/15"
            >
                <Calendar size={13} />
                {fmtDate(date)}
                {time && <><Bell size={12} /> {time}</>}
            </span>
            {open && coords && createPortal(
                <div
                    ref={popRef}
                    data-gnosi-portal="dateref"
                    style={{ position: 'fixed', top: coords.top, left: coords.left, width: 260, zIndex: 9999 }}
                    className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] p-3 shadow-xl"
                >
                    <label className="mb-1 block text-xs font-semibold text-[var(--text-tertiary)]">{t('common.date', 'Data')}</label>
                    <input
                        type="date"
                        value={draftDate}
                        onChange={(e) => setDraftDate(e.target.value)}
                        className="mb-2 w-full rounded border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-2 py-1 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--gnosi-primary)]"
                    />
                    <label className="mb-1 flex items-center gap-1 text-xs font-semibold text-[var(--text-tertiary)]">
                        <Bell size={12} /> {t('editor.date_reminder_label', 'Recordatori (opcional)')}
                    </label>
                    <div className="flex items-center gap-2">
                        <input
                            type="time"
                            value={draftTime}
                            onChange={(e) => setDraftTime(e.target.value)}
                            className="flex-1 rounded border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-2 py-1 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--gnosi-primary)]"
                        />
                        {draftTime && (
                            <button type="button" onClick={() => setDraftTime('')} className="text-xs text-[var(--text-tertiary)] hover:text-[var(--gnosi-danger,#dc2626)]">
                                {t('editor.date_reminder_clear', 'Treu')}
                            </button>
                        )}
                    </div>
                    <div className="mt-2 flex justify-end">
                        <button type="button" onMouseDown={(e) => { e.preventDefault(); save(); }} className="rounded px-2 py-1 text-xs font-medium text-[var(--gnosi-primary)] hover:bg-[var(--gnosi-primary)]/10">
                            {t('common.save', 'Desa')}
                        </button>
                    </div>
                </div>,
                document.body,
            )}
        </span>
    );
}
