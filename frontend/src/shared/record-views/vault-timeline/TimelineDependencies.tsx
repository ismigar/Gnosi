import { useId } from 'react';
import type { TimelineController } from './types';
import type { TimelineDrag } from './useTimelineDrag';

export const TIMELINE_ROW_HEIGHT = 56;

export function TimelineDependencies({ controller, drag }: { readonly controller: TimelineController; readonly drag: TimelineDrag | null }) {
    const markerId = useId().replace(/:/g, '');
    const width = Number.parseFloat(controller.scaleMinWidth);
    const height = controller.visibleNotes.length * TIMELINE_ROW_HEIGHT;
    const rows = new Map(controller.visibleNotes.map((note, index) => [note.id, { note, index }]));
    const x = (date: Date) => controller.calculatePosition(date) / 100 * width;
    const y = (index: number) => (index + 0.5) * TIMELINE_ROW_HEIGHT;
    return <svg aria-hidden="true" width={width} height={height} className="pointer-events-none absolute top-0 z-[2] overflow-visible" style={{ left: controller.columnWidth }}>
        <defs><marker id={markerId} markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0 L7 3.5 L0 7" fill="var(--text-tertiary)" /></marker></defs>
        {controller.visibleNotes.flatMap((note, index) => controller.getPredecessors(note).map(id => {
            const predecessor = rows.get(id);
            if (!predecessor || note.hasDates === false || predecessor.note.hasDates === false) return null;
            const start = drag?.note.id === note.id ? drag.start : note.start;
            const end = drag?.note.id === id ? drag.end : predecessor.note.end;
            const from = x(end); const to = x(start); const bend = from + 14;
            const midpoint = y(index) - TIMELINE_ROW_HEIGHT / 2;
            const path = to >= bend
                ? `M${String(from)},${String(y(predecessor.index))} H${String(bend)} V${String(y(index))} H${String(to - 3)}`
                : `M${String(from)},${String(y(predecessor.index))} H${String(bend)} V${String(midpoint)} H${String(to - 14)} V${String(y(index))} H${String(to - 3)}`;
            return <path key={`${id}-${note.id}`} d={path} fill="none" stroke="var(--text-tertiary)" strokeWidth="1.5" opacity="0.65" markerEnd={`url(#${markerId})`} />;
        }))}
        {drag?.mode === 'dependency' && rows.get(drag.note.id) ? (() => {
            const source = rows.get(drag.note.id);
            const target = drag.targetId ? rows.get(drag.targetId) : null;
            if (!source) return null;
            const from = x(drag.note.end);
            const to = target ? x(target.note.start) : from + drag.delta;
            const targetY = target ? y(target.index) : y(source.index) + 24;
            return <path d={`M${String(from)},${String(y(source.index))} H${String(from + 16)} V${String(targetY)} H${String(to)}`}
                fill="none" stroke="var(--gnosi-primary)" strokeWidth="2" strokeDasharray="4 3" />;
        })() : null}
    </svg>;
}
