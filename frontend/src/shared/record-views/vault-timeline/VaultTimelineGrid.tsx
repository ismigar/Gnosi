import type { ChangeEvent, MouseEvent } from 'react';
import { Calendar, FileText, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type {
    TimelineChartNote,
    TimelineController,
} from './types';


interface TimelineGridProps {
    readonly controller: TimelineController;
    readonly onNoteSelect?: (noteId: string) => void;
}


interface TimelineRowProps extends TimelineGridProps {
    readonly note: TimelineChartNote;
}


function percent(value: number): string {
    return `${String(value)}%`;
}


function TimelineRow({ controller, note, onNoteSelect }: TimelineRowProps) {
    const { t } = useTranslation();
    const barStart = note.isParent ? note.summaryStart ?? note.start : note.start;
    const barEnd = note.isParent ? note.summaryEnd ?? note.end : note.end;
    const startPosition = controller.calculatePosition(barStart);
    const endPosition = controller.calculatePosition(barEnd);
    const width = Math.max(endPosition - startPosition, 0.5);
    const predecessors = controller.getPredecessors(note);
    const selected = controller.isSelected(note.id);
    const stopPropagation = (event: MouseEvent<HTMLLabelElement>): void => {
        event.stopPropagation();
    };
    const toggleSelection = (event: ChangeEvent<HTMLInputElement>): void => {
        const nativeEvent = event.nativeEvent;
        const isShift = 'shiftKey' in nativeEvent && nativeEvent.shiftKey === true;
        controller.toggleSelect(note.id, isShift);
    };

    return <div className="group flex h-12 border-b border-[var(--border-primary)] transition-colors hover:bg-[var(--bg-secondary)]/50">
        <div
            className={`sticky left-0 z-10 flex w-64 shrink-0 cursor-pointer items-center gap-2 overflow-hidden border-r border-[var(--border-primary)] pr-4 ${selected
                ? 'bg-[var(--gnosi-primary)]/10'
                : 'bg-[var(--bg-primary)]'}`}
            onClick={() => { onNoteSelect?.(note.id); }}
            style={{ paddingLeft: `${String(16 + note.depth * 16)}px` }}
        >
            {note.depth > 0 ? <span
                aria-hidden="true"
                className="shrink-0 select-none font-mono text-[10px] text-[var(--text-tertiary)]"
            >└</span> : null}
            <label
                className="inline-flex cursor-pointer items-center"
                onClick={stopPropagation}
            >
                <input
                    checked={selected}
                    className="h-3.5 w-3.5 cursor-pointer rounded border-[var(--border-primary)] bg-[var(--bg-secondary)] text-[var(--gnosi-primary)] focus:ring-[var(--gnosi-primary)]"
                    onChange={toggleSelection}
                    type="checkbox"
                />
            </label>
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-[var(--border-primary)] bg-[var(--bg-secondary)] text-xs">
                <FileText className="text-[var(--text-tertiary)]" size={14} />
            </div>
            <div className="flex min-w-0 flex-1 flex-col">
                <span
                    className={`${note.isParent ? 'font-bold' : 'font-semibold'} truncate text-xs text-[var(--text-primary)] transition-colors group-hover:text-[var(--gnosi-primary)]`}
                    {...controller.titlePreview.getTitleProps(note.id)}
                >
                    {note.title || 'Sense Títol'}
                </span>
                <div className="flex items-center gap-2">
                    <span className="text-[9px] font-medium text-[var(--text-tertiary)]">
                        {controller.formatTimelineDate(note.start)}
                    </span>
                </div>
            </div>
            <button
                className="p-1 text-[var(--gnosi-primary)] opacity-0 transition-all hover:rounded hover:bg-[var(--gnosi-primary)]/10 group-hover:opacity-100"
                onClick={(event) => {
                    event.stopPropagation();
                    controller.setSelectingPredecessorFor(note.id);
                }}
                title={t('timeline.add_predecessor', 'Add predecessor')}
                type="button"
            >
                <Plus size={12} />
            </button>
        </div>
        <div
            className="relative flex h-full flex-1 items-center px-0"
            style={{ minWidth: controller.scaleMinWidth }}
        >
            {predecessors.map((predecessorId) => {
                const predecessor = controller.chartData.find(
                    ({ id }) => id === predecessorId,
                );
                if (!predecessor) return null;
                const predecessorEnd = controller.calculatePosition(predecessor.end);
                if (predecessorEnd > startPosition) return null;
                return <div
                    className="pointer-events-none absolute h-px bg-indigo-200/50"
                    key={`${note.id}-${predecessorId}`}
                    style={{
                        left: percent(predecessorEnd),
                        width: percent(startPosition - predecessorEnd),
                        top: '50%',
                        transform: 'translateY(-50%)',
                    }}
                />;
            })}
            {note.isParent ? <div
                className="group/bar absolute h-2 cursor-pointer rounded-[2px]"
                onClick={() => { onNoteSelect?.(note.id); }}
                style={{
                    left: percent(startPosition),
                    width: percent(width),
                    minWidth: '24px',
                    backgroundColor: 'var(--text-secondary)',
                }}
            >
                <span
                    aria-hidden="true"
                    className="absolute -left-[1px] top-[3px] h-2 w-2 rotate-45 bg-[var(--text-secondary)]"
                />
                <span
                    aria-hidden="true"
                    className="absolute -right-[1px] top-[3px] h-2 w-2 rotate-45 bg-[var(--text-secondary)]"
                />
                <div className="pointer-events-none absolute left-1/2 top-full z-30 mt-3 -translate-x-1/2 whitespace-nowrap rounded border border-[var(--border-primary)] bg-[var(--bg-tertiary)] px-3 py-2 text-[10px] font-medium text-[var(--text-primary)] opacity-0 shadow-xl transition-opacity group-hover/bar:opacity-100">
                    <strong>{note.title}</strong><br />
                    {controller.formatTimelineDate(barStart)} - {' '}
                    {controller.formatTimelineDate(barEnd)}
                </div>
            </div> : <div
                className="group/bar absolute flex h-6 cursor-pointer items-center overflow-hidden rounded-md border border-black/10 px-2 shadow-sm transition-all hover:scale-y-105 hover:brightness-110 dark:border-white/10"
                onClick={() => { onNoteSelect?.(note.id); }}
                style={{
                    left: percent(startPosition),
                    width: percent(width),
                    minWidth: '60px',
                    backgroundColor: controller.getBarColor(note),
                }}
            >
                <div className="flex min-w-0 items-center gap-1 text-white">
                    <span className="truncate whitespace-nowrap text-[10px] font-bold">
                        {note.title || 'Note'}
                    </span>
                </div>
                <div className="pointer-events-none absolute left-1/2 top-full z-30 mt-2 -translate-x-1/2 whitespace-nowrap rounded border border-[var(--border-primary)] bg-[var(--bg-tertiary)] px-3 py-2 text-[10px] font-medium text-[var(--text-primary)] opacity-0 shadow-xl transition-opacity group-hover/bar:opacity-100">
                    <strong>{note.title}</strong><br />
                    {controller.formatTimelineDate(note.start)} - {' '}
                    {controller.formatTimelineDate(note.end)}
                </div>
            </div>}
        </div>
    </div>;
}


export function VaultTimelineGrid({ controller, onNoteSelect }: TimelineGridProps) {
    const { t } = useTranslation();
    return <div className="flex flex-1 flex-col overflow-hidden">
        <div
            className="custom-scrollbar relative flex-1 overflow-x-auto overflow-y-auto bg-[var(--bg-primary)] pt-vault-header-top"
            id={controller.scrollContainerId}
        >
            <div className="sticky top-0 z-10 flex h-10 min-w-full border-b border-[var(--border-primary)] bg-[var(--bg-secondary)] shadow-sm">
                <div className="flex w-64 shrink-0 items-center border-r border-[var(--border-primary)] bg-[var(--bg-secondary)] px-4 text-[10px] font-bold uppercase tracking-wider text-[var(--text-tertiary)]">
                    {t('timeline.col_title', 'Record Title')}
                </div>
                <div
                    className="relative flex-1"
                    style={{ minWidth: controller.scaleMinWidth }}
                >
                    {controller.timeScale?.ticks.map((tick, index, ticks) => {
                        const left = controller.calculatePosition(tick.at);
                        const next = ticks[index + 1]?.at ?? controller.timeScale?.end;
                        const width = next
                            ? controller.calculatePosition(next) - left : 0;
                        return <div
                            className="absolute flex h-full items-center truncate border-r border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 text-[10px] font-bold text-[var(--text-secondary)]"
                            key={index}
                            style={{ left: percent(left), width: percent(width) }}
                        >
                            {tick.label}
                        </div>;
                    })}
                </div>
            </div>
            <div className="relative min-h-full min-w-full">
                <div className="pointer-events-none absolute inset-0 flex">
                    <div className="w-64 shrink-0 border-r border-[var(--border-primary)]" />
                    <div
                        className="relative flex-1"
                        style={{ minWidth: controller.scaleMinWidth }}
                    >
                        {controller.timeScale?.ticks.map((tick, index) => <div
                            className="absolute h-full border-r border-[var(--border-primary)]"
                            key={index}
                            style={{
                                left: percent(controller.calculatePosition(tick.at)),
                            }}
                        />)}
                    </div>
                </div>
                <div className="relative z-0">
                    {controller.chartData.map((note) => <TimelineRow
                        controller={controller}
                        key={note.id}
                        note={note}
                        onNoteSelect={onNoteSelect}
                    />)}
                </div>
            </div>
        </div>
        {controller.chartData.length === 0 ? <div className="flex h-64 w-full flex-col items-center justify-center text-[var(--text-tertiary)]">
            <Calendar
                className="mb-4 text-[var(--bg-tertiary)]"
                size={48}
                strokeWidth={1}
            />
            <p>{t('timeline.no_data', 'No data to show in the timeline.')}</p>
        </div> : null}
    </div>;
}
