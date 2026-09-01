import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Calendar, Bell } from 'lucide-react';

import i18n from '../../../shared/i18n/i18n';

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

type InlineScalar = string | number | bigint | boolean | null | undefined;

interface DateMentionContent {
    readonly props?: {
        readonly date?: InlineScalar;
        readonly time?: InlineScalar;
    };
}

interface DateMentionUpdate {
    readonly props: {
        readonly date: string;
        readonly time: string;
    };
    readonly type: 'dateref';
}

export interface DateMentionInlineProps {
    readonly inlineContent?: DateMentionContent | null;
    readonly updateInlineContent: (content: DateMentionUpdate) => unknown;
}

interface PopoverCoordinates {
    readonly left: number;
    readonly top: number;
}

function formatDate(iso: string): string {
    if (!iso) return i18n.t('common.date', "Date");
    try {
        const d = new Date(iso + (iso.length === 10 ? 'T00:00:00' : ''));
        return new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'long', year: 'numeric' }).format(d);
    } catch { return iso; }
}

export default function DateMentionInline({
    inlineContent,
    updateInlineContent,
}: DateMentionInlineProps) {
    const { t } = useTranslation();
    const date = String(inlineContent?.props?.date || '').trim();
    const time = String(inlineContent?.props?.time || '').trim();
    const [open, setOpen] = useState(false);
    const [draftDate, setDraftDate] = useState(date);
    const [draftTime, setDraftTime] = useState(time);
    const chipRef = useRef<HTMLSpanElement>(null);
    const popRef = useRef<HTMLDivElement>(null);
    const [coords, setCoords] = useState<PopoverCoordinates | null>(null);

    useEffect(() => {
        let active = true;
        queueMicrotask(() => {
            if (!active) return;
            setDraftDate(date);
            setDraftTime(time);
        });
        return () => {
            active = false;
        };
    }, [date, time]);

    const save = useCallback(() => {
        try {
            updateInlineContent({ type: 'dateref', props: { date: draftDate, time: draftTime } });
        } catch { /* noop */ }
        setOpen(false);
    }, [draftDate, draftTime, updateInlineContent]);

    useEffect(() => {
        if (!open) return undefined;
        const onDown = (event: MouseEvent): void => {
            if (!(event.target instanceof Node)) return;
            if (popRef.current?.contains(event.target) || chipRef.current?.contains(event.target)) return;
            save();
        };
        document.addEventListener('mousedown', onDown, true);
        return () => {
            document.removeEventListener('mousedown', onDown, true);
        };
    }, [open, save]);

    const togglePopover = (): void => {
        if (!open && chipRef.current) {
            const rect = chipRef.current.getBoundingClientRect();
            setCoords({
                top: rect.bottom + 6,
                left: Math.min(rect.left, window.innerWidth - 280),
            });
        }
        setOpen((value) => !value);
    };

    return (
        <span className="bn-dateref">
            <span
                ref={chipRef}
                contentEditable={false}
                onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    togglePopover();
                }}
                title={time ? t('editor.date_reminder_tooltip', "Reminder: {{date}} at {{time}}", { date: formatDate(date), time }) : formatDate(date)}
                className="mx-0.5 inline-flex cursor-pointer select-none items-center gap-1 rounded px-1.5 py-0.5 text-sm text-[var(--gnosi-primary)] bg-[var(--gnosi-primary)]/8 hover:bg-[var(--gnosi-primary)]/15"
            >
                <Calendar size={13} />
                {formatDate(date)}
                {time && <><Bell size={12} /> {time}</>}
            </span>
            {open && coords && createPortal(
                <div
                    ref={popRef}
                    data-gnosi-portal="dateref"
                    style={{ position: 'fixed', top: coords.top, left: coords.left, width: 260, zIndex: 'var(--z-popover)' }}
                    className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] p-3 shadow-xl"
                >
                    <label className="mb-1 block text-xs font-semibold text-[var(--text-tertiary)]">{t('common.date', "Date")}</label>
                    <input
                        type="date"
                        value={draftDate}
                        onChange={(event) => {
                            setDraftDate(event.target.value);
                        }}
                        className="mb-2 w-full rounded border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-2 py-1 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--gnosi-primary)]"
                    />
                    <label className="mb-1 flex items-center gap-1 text-xs font-semibold text-[var(--text-tertiary)]">
                        <Bell size={12} /> {t('editor.date_reminder_label', "Reminder (optional)")}
                    </label>
                    <div className="flex items-center gap-2">
                        <input
                            type="time"
                            value={draftTime}
                            onChange={(event) => {
                                setDraftTime(event.target.value);
                            }}
                            className="flex-1 rounded border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-2 py-1 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--gnosi-primary)]"
                        />
                        {draftTime && (
                            <button type="button" onClick={() => {
                                setDraftTime('');
                            }} className="text-xs text-[var(--text-tertiary)] hover:text-[var(--gnosi-danger,#dc2626)]">
                                {t('editor.date_reminder_clear', "Clear")}
                            </button>
                        )}
                    </div>
                    <div className="mt-2 flex justify-end">
                        <button type="button" onMouseDown={(e) => { e.preventDefault(); save(); }} className="rounded px-2 py-1 text-xs font-medium text-[var(--gnosi-primary)] hover:bg-[var(--gnosi-primary)]/10">
                            {t('common.save', "Save")}
                        </button>
                    </div>
                </div>,
                document.body,
            )}
        </span>
    );
}
