import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { subscribeWindowEvent } from '../../platform/browser-events';
import { notifyError } from '../../notifications/notifyError';
import { timelineErrorKey } from './timelineLabels';
import { shiftTimelineDate } from './timelineScale';
import type { TimelineChartNote, TimelineController } from './types';

export type DragMode = 'move' | 'start' | 'end' | 'dependency';
export interface TimelineDrag {
    readonly note: TimelineChartNote;
    readonly mode: DragMode;
    readonly pointerId: number;
    readonly x: number;
    readonly width: number;
    readonly originalScroll: number;
    readonly delta: number;
    readonly start: Date;
    readonly end: Date;
    readonly targetId: string | null;
    readonly point: { readonly x: number; readonly y: number };
}

export function useTimelineDrag(controller: TimelineController) {
    const { t } = useTranslation();
    const [drag, setDrag] = useState<TimelineDrag | null>(null);
    const current = useRef<TimelineDrag | null>(null);
    const suppressClick = useRef(false);
    const begin = (event: ReactPointerEvent<HTMLElement>, note: TimelineChartNote, mode: DragMode) => {
        if (event.button !== 0 || controller.saving || (mode === 'dependency' ? !controller.canEditDependencies : !controller.canEditDates)) return;
        const track = event.currentTarget.closest<HTMLElement>('[data-timeline-track]');
        if (!track || !controller.timeScale) return;
        event.preventDefault(); event.stopPropagation();
        const element = document.getElementById(controller.scrollContainerId);
        const rect = track.getBoundingClientRect();
        const next: TimelineDrag = { note, mode, pointerId: event.pointerId, x: event.clientX,
            width: rect.width || Number.parseFloat(controller.scaleMinWidth), originalScroll: element?.scrollLeft ?? 0,
            delta: 0, start: note.start, end: note.end, targetId: null, point: { x: event.clientX, y: event.clientY } };
        current.current = next; suppressClick.current = false; setDrag(next);
        event.currentTarget.setPointerCapture(event.pointerId);
    };
    useEffect(() => {
        if (!drag) return;
        const move = (event: PointerEvent) => {
            const previous = current.current;
            if (!previous || event.pointerId !== previous.pointerId || !controller.timeScale) return;
            const container = document.getElementById(controller.scrollContainerId);
            const bounds = container?.getBoundingClientRect();
            if (container && bounds) {
                if (event.clientX > bounds.right - 32) container.scrollLeft += 18;
                else if (event.clientX < bounds.left + controller.columnWidth + 32) container.scrollLeft -= 18;
                if (event.clientY > bounds.bottom - 24) container.scrollTop += 12;
                else if (event.clientY < bounds.top + 80) container.scrollTop -= 12;
            }
            const dx = event.clientX - previous.x + (container?.scrollLeft ?? 0) - previous.originalScroll;
            const span = controller.timeScale.end.getTime() - controller.timeScale.start.getTime();
            const unit = controller.timelineUnit === 'hours' ? 3600000 : controller.timelineUnit === 'years' ? 365 * 86400000 : 86400000;
            const steps = Math.round(dx / previous.width * span / unit);
            let start = previous.note.start; let end = previous.note.end;
            if (previous.mode === 'move' || previous.mode === 'start') start = shiftTimelineDate(start, steps, controller.timelineUnit);
            if (previous.mode === 'move' || previous.mode === 'end') end = shiftTimelineDate(end, steps, controller.timelineUnit);
            if (end < start) { if (previous.mode === 'start') start = end; else end = start; }
            const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-timeline-task]');
            const next = { ...previous, start, end, delta: dx,
                targetId: target?.dataset.timelineTask ?? null, point: { x: event.clientX, y: event.clientY } };
            current.current = next; setDrag(next);
            if (Math.abs(dx) > 3 || previous.mode !== 'move') suppressClick.current = true;
        };
        const finish = (event: PointerEvent) => {
            const last = current.current;
            if (!last || event.pointerId !== last.pointerId) return;
            current.current = null; setDrag(null);
            if (last.mode === 'dependency') {
                if (last.targetId && last.targetId !== last.note.id) {
                    void controller.handleAddPredecessor(last.targetId, last.note.id)
                        .catch((error: unknown) => { notifyError('timeline-dependency', error,
                            t(timelineErrorKey(error))); });
                }
            } else if (last.start.getTime() !== last.note.start.getTime() || last.end.getTime() !== last.note.end.getTime()) {
                void controller.updateDates(last.note.id, last.start, last.end)
                    .catch((error: unknown) => { notifyError('timeline-dates', error, t(timelineErrorKey(error))); });
            }
        };
        const cancel = () => { current.current = null; suppressClick.current = true; setDrag(null); };
        const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); cancel(); } };
        const cleanup = [subscribeWindowEvent('pointermove', move), subscribeWindowEvent('pointerup', finish),
            subscribeWindowEvent('pointercancel', cancel), subscribeWindowEvent('keydown', key)];
        return () => { for (const unsubscribe of cleanup) unsubscribe(); };
    }, [controller, drag, t]);
    const consumeClick = () => { const suppressed = suppressClick.current; suppressClick.current = false; return suppressed; };
    return { drag, begin, consumeClick };
}
