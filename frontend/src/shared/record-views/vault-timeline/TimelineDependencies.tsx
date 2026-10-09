import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmModal } from '../../ui/dialogs/ConfirmModal';
import { notifyError } from '../../notifications/notifyError';
import { timelineErrorKey, timelineTitle } from './timelineLabels';
import type { TimelineController } from './types';
import type { TimelineDrag } from './useTimelineDrag';

export const TIMELINE_ROW_HEIGHT = 56;

export function TimelineDependencies({ controller, drag }: { readonly controller: TimelineController; readonly drag: TimelineDrag | null }) {
    const { t } = useTranslation();
    const [selected, setSelected] = useState<{ readonly from: string; readonly to: string } | null>(null);
    const markerId = useId().replace(/:/g, '');
    const width = Number.parseFloat(controller.scaleMinWidth);
    const height = controller.visibleNotes.length * TIMELINE_ROW_HEIGHT;
    const rows = new Map(controller.visibleNotes.map((note, index) => [note.id, { note, index }]));
    const x = (date: Date) => controller.calculatePosition(date) / 100 * width;
    const y = (index: number) => (index + 0.5) * TIMELINE_ROW_HEIGHT;
    return <><svg aria-label={t('timeline.dependencies', 'Task dependencies')} width={width} height={height} className="pointer-events-none absolute top-0 z-[2] overflow-visible" style={{ left: controller.columnWidth }}>
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
            const label = t('timeline.dependency_link', 'Dependency: {{from}} → {{to}}', {
                from: timelineTitle(predecessor.note.title, t('common.untitled', 'Untitled')),
                to: timelineTitle(note.title, t('common.untitled', 'Untitled')),
            });
            const editable = controller.canEditDependencies && !controller.saving && !drag;
            return <g key={`${id}-${note.id}`} data-timeline-dependency={`${id}->${note.id}`}
                role={controller.canEditDependencies ? 'button' : undefined}
                tabIndex={controller.canEditDependencies ? 0 : undefined}
                aria-label={label} aria-disabled={!editable}
                className="group/dependency outline-none"
                onClick={event => { event.stopPropagation(); if (editable) setSelected({ from: id, to: note.id }); }}
                onKeyDown={event => {
                    if (editable && ['Enter', ' ', 'Delete', 'Backspace'].includes(event.key)) { event.preventDefault(); event.stopPropagation(); setSelected({ from: id, to: note.id }); }
                }}>
                <title>{label}</title>
                <path d={path} fill="none" stroke="transparent" strokeWidth="14" style={{ pointerEvents: editable ? 'stroke' : 'none', cursor: 'pointer' }} />
                <path d={path} fill="none" stroke="var(--text-tertiary)" strokeWidth="1.5" opacity="0.65" markerEnd={`url(#${markerId})`}
                    className="group-hover/dependency:stroke-[var(--gnosi-primary)] group-focus/dependency:stroke-[var(--gnosi-primary)]" />
            </g>;
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
    </svg>
        <ConfirmModal isOpen={Boolean(selected)} onClose={() => { setSelected(null); }}
            title={t('timeline.remove_dependency', 'Remove dependency')}
            confirmText={t('timeline.remove_dependency', 'Remove dependency')}
            autofocusConfirm={false}
            message={<>
                <p>{timelineTitle(controller.chartData.find(note => note.id === selected?.from)?.title, '')} → {timelineTitle(controller.chartData.find(note => note.id === selected?.to)?.title, '')}</p>
                <p className="mt-2">{t('timeline.remove_dependency_hint', 'Task dates will be preserved. You can undo this change.')}</p>
            </>}
            onConfirm={async () => {
                if (!selected) return;
                try { await controller.removePredecessor(selected.to, selected.from); setSelected(null); }
                catch (error) { notifyError('timeline-dependency-remove', error, t(timelineErrorKey(error))); }
            }} />
    </>;
}
