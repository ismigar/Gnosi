import type { PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { notifyError } from '../../notifications/notifyError';
import { timelineErrorKey, timelineTitle } from './timelineLabels';
import { shiftTimelineDate } from './timelineScale';
import type { TimelineChartNote, TimelineController } from './types';
import type { DragMode, TimelineDrag } from './useTimelineDrag';

export function TimelineBar({ controller, note, title, drag, begin, consumeClick, onNoteSelect }: {
    readonly controller: TimelineController; readonly note: TimelineChartNote; readonly title: string;
    readonly drag: TimelineDrag | null;
    readonly begin: (event: PointerEvent<HTMLElement>, note: TimelineChartNote, mode: DragMode) => void;
    readonly consumeClick: () => boolean;
    readonly onNoteSelect?: (id: string) => void;
}) {
    const { t } = useTranslation();
    const preview = drag?.note.id === note.id && drag.mode !== 'dependency' ? drag : null;
    const start = preview?.start ?? (note.isParent ? note.summaryStart ?? note.start : note.start);
    const end = preview?.end ?? (note.isParent ? note.summaryEnd ?? note.end : note.end);
    const left = controller.calculatePosition(start);
    const width = Math.max(0, controller.calculatePosition(end) - left);
    const milestone = start.getTime() === end.getTime();
    const duration = Math.round((end.getTime() - start.getTime()) / (controller.timelineUnit === 'hours' ? 3600000 : controller.timelineUnit === 'years' ? 365 * 86400000 : 86400000) * 100) / 100;
    const status = controller.getStatus(note);
    const progress = controller.getProgress(note);
    const editable = controller.canEditDates && !note.isParent && !controller.saving;
    const info = `${timelineTitle(note.title, t('common.untitled', 'Untitled'))}\n${controller.formatTimelineDate(start)} → ${controller.formatTimelineDate(end)}\n${t(`timeline.duration_${controller.timelineUnit}`, '{{count}} days', { count: duration })}${status ? ` · ${status}` : ''}${progress ? ` · ${String(progress)}%` : ''}`;
    return <div className={`group/bar absolute z-[5] touch-none select-none hover:z-30 ${preview ? 'z-30' : ''}`}
        data-timeline-task={note.isParent ? undefined : note.id} style={{ left: `${String(left)}%`, width: milestone ? 0 : `${String(width)}%` }}>
        <div role="button" tabIndex={0} aria-label={info} title={info}
            onPointerDown={event => { if (editable) begin(event, note, 'move'); }}
            onClick={() => { if (!consumeClick()) onNoteSelect?.(note.id); }}
            onKeyDown={event => {
                if (event.key === 'Enter') onNoteSelect?.(note.id);
                if (!editable || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
                event.preventDefault(); event.stopPropagation();
                const steps = event.key === 'ArrowLeft' ? -1 : 1;
                const nextStart = event.shiftKey ? note.start : shiftTimelineDate(note.start, steps, controller.timelineUnit);
                const nextEnd = shiftTimelineDate(note.end, steps, controller.timelineUnit);
                if (nextEnd >= nextStart) void controller.updateDates(note.id, nextStart, nextEnd)
                    .catch((error: unknown) => { notifyError('timeline-dates', error, t(timelineErrorKey(error))); });
            }}
            className={`relative flex items-center rounded-md focus-visible:outline-2 focus-visible:outline-[var(--gnosi-primary)] ${editable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'} ${note.isParent ? 'h-2' : 'h-7 shadow-sm'} ${milestone ? 'h-3 w-3 -translate-x-1/2 rotate-45 rounded-none' : 'w-full'}`}
            style={{ backgroundColor: note.isParent ? 'var(--text-secondary)' : controller.getBarColor(note), minWidth: milestone ? undefined : '2px' }}>
            {note.isParent ? <>
                <span className="absolute left-0 top-1 h-2 w-2 rotate-45 bg-[var(--text-secondary)]" />
                <span className="absolute right-0 top-1 h-2 w-2 rotate-45 bg-[var(--text-secondary)]" />
            </> : <>
                {progress > 0 && !milestone ? <span className="pointer-events-none absolute inset-y-0 left-0 rounded-l-md bg-black/20" style={{ width: `${String(Math.min(100, Math.max(0, progress)))}%` }} /> : null}
                {!milestone ? <span className="pointer-events-none relative truncate px-3 text-[11px] font-semibold text-white">{title}</span> : null}
            </>}
        </div>
        {editable && !milestone ? (['start', 'end'] as const).map(edge => <button type="button" key={edge}
            aria-label={t(`timeline.resize_${edge}`, edge === 'start' ? 'Adjust start' : 'Adjust end')}
            title={t(`timeline.resize_${edge}`)}
            onClick={event => { event.stopPropagation(); }}
            onPointerDown={event => { begin(event, note, edge); }}
            className={`absolute inset-y-0 w-2 cursor-ew-resize rounded bg-black/20 opacity-0 focus:opacity-100 group-hover/bar:opacity-100 ${edge === 'start' ? 'left-0' : 'right-0'}`} />) : null}
        {controller.canEditDependencies && !note.isParent ? <button type="button"
            aria-label={t('timeline.connect_successor', 'Drag to connect a successor')}
            title={t('timeline.connect_successor', 'Drag to connect a successor')}
            disabled={controller.saving}
            onPointerDown={event => { begin(event, note, 'dependency'); }}
            onClick={event => { event.stopPropagation(); }}
            className="absolute -right-1.5 -top-2.5 h-3 w-3 cursor-crosshair rounded-full border-2 border-[var(--gnosi-primary)] bg-[var(--bg-primary)] opacity-0 focus:opacity-100 group-hover/bar:opacity-100" /> : null}
        <div className={`pointer-events-none absolute left-0 top-full mt-2 min-w-48 whitespace-pre-line rounded-lg border border-[var(--border-primary)] bg-[var(--bg-tertiary)] px-3 py-2 text-xs text-[var(--text-primary)] shadow-xl ${preview ? 'opacity-100' : 'opacity-0 group-hover/bar:opacity-100 group-focus-within/bar:opacity-100'}`}>{info}</div>
    </div>;
}
