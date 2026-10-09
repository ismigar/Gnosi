import { useRef, type ChangeEvent } from 'react';
import { Calendar, ChevronDown, ChevronRight, ExternalLink, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { TimelineBar } from './TimelineBar';
import { timelineTitle } from './timelineLabels';
import { TimelineDependencies, TIMELINE_ROW_HEIGHT } from './TimelineDependencies';
import { useTimelineDrag } from './useTimelineDrag';
import type { TimelineChartNote, TimelineController, TimelineTick } from './types';

interface TimelineGridProps {
    readonly controller: TimelineController;
    readonly onNoteSelect?: (noteId: string) => void;
}

function compactTitle(note: TimelineChartNote, controller: TimelineController, fallback: string): string {
    const title = timelineTitle(note.title, fallback);
    const index = controller.chartData.findIndex(candidate => candidate.id === note.id);
    const parent = controller.chartData.slice(0, index).reverse().find(candidate => candidate.depth < note.depth);
    const parentTitle = parent ? timelineTitle(parent.title, '') : '';
    let shared = 0;
    while (shared < title.length && shared < parentTitle.length && title[shared] === parentTitle[shared]) shared += 1;
    const prefix = title.slice(0, shared);
    const boundary = Math.max(prefix.lastIndexOf(': '), prefix.lastIndexOf(' · '), prefix.lastIndexOf(' - '));
    return note.depth > 0 && boundary >= 4 ? title.slice(boundary).replace(/^[:·\s-]+/, '') : title;
}

function HeaderTicks({ ticks, controller, upper = false }: { readonly ticks: readonly TimelineTick[]; readonly controller: TimelineController; readonly upper?: boolean }) {
    return <>{ticks.map((tick, index) => {
        const left = controller.calculatePosition(tick.at);
        const next = ticks[index + 1]?.at ?? controller.timeScale?.end;
        const width = next ? controller.calculatePosition(next) - left : 0;
        return <div key={tick.at.getTime()} className={`absolute flex h-8 items-center truncate border-r border-[var(--border-primary)] px-2 text-[11px] ${upper ? 'top-0 font-semibold text-[var(--text-primary)]' : 'bottom-0 text-[var(--text-secondary)]'}`}
            style={{ left: `${String(left)}%`, width: `${String(width)}%` }} title={tick.label}>{width / 100 * Number.parseFloat(controller.scaleMinWidth) >= 24 ? tick.label : ''}</div>;
    })}</>;
}

export function VaultTimelineGrid({ controller, onNoteSelect }: TimelineGridProps) {
    const { t } = useTranslation();
    const { drag, begin, consumeClick } = useTimelineDrag(controller);
    const resizing = useRef<{ readonly x: number; readonly width: number } | null>(null);
    const { scrollLeft } = controller;
    const contentWidth = controller.columnWidth + Number.parseFloat(controller.scaleMinWidth);
    const today = controller.calculatePosition(new Date());
    return <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div id={controller.scrollContainerId} className="custom-scrollbar relative min-h-0 flex-1 overflow-auto bg-[var(--bg-primary)]" style={{ overflowX: 'hidden', overflowY: 'auto' }} aria-busy={controller.saving} onScroll={event => { controller.setScrollLeft(event.currentTarget.scrollLeft); }}>
            <div className="sticky top-0 z-40 flex h-16 border-b border-[var(--border-primary)] bg-[var(--bg-secondary)]" style={{ width: contentWidth }}>
                <div className="sticky left-0 z-50 flex shrink-0 items-center border-r border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 text-xs font-semibold text-[var(--text-secondary)]" style={{ width: controller.columnWidth }}>
                    {t('timeline.col_title', 'Record Title')}
                    <button type="button" role="separator" aria-orientation="vertical" aria-label={t('timeline.resize_column', 'Resize title column')}
                        aria-valuenow={controller.columnWidth} aria-valuemin={220} aria-valuemax={640}
                        className="absolute inset-y-0 -right-1 z-50 w-2 cursor-col-resize touch-none hover:bg-[var(--gnosi-primary)]/30 focus-visible:bg-[var(--gnosi-primary)]/30"
                        onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); resizing.current = { x: event.clientX, width: controller.columnWidth }; event.currentTarget.setPointerCapture(event.pointerId); }}
                        onPointerMove={event => { if (resizing.current) controller.setColumnWidth(Math.max(220, Math.min(640, resizing.current.width + event.clientX - resizing.current.x))); }}
                        onPointerUp={() => { resizing.current = null; }} onPointerCancel={() => { resizing.current = null; }}
                        onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); controller.setColumnWidth(Math.max(220, Math.min(640, controller.columnWidth + (event.key === 'ArrowLeft' ? -20 : 20)))); } }} />
                </div>
                <div className="relative shrink-0" style={{ width: controller.scaleMinWidth }}>
                    <HeaderTicks ticks={controller.timeScale?.months ?? []} controller={controller} upper />
                    <HeaderTicks ticks={controller.timeScale?.ticks ?? []} controller={controller} />
                </div>
            </div>
            <div className="relative" style={{ width: contentWidth, minHeight: controller.visibleNotes.length * TIMELINE_ROW_HEIGHT }}>
                <div className="pointer-events-none absolute inset-y-0" style={{ left: controller.columnWidth, width: controller.scaleMinWidth }}>
                    {controller.timeScale?.ticks.map(tick => <div key={tick.at.getTime()} className="absolute h-full border-r border-[var(--border-primary)] opacity-60" style={{ left: `${String(controller.calculatePosition(tick.at))}%` }} />)}
                    {today >= 0 && today <= 100 ? <div className="absolute z-[1] h-full border-l-2 border-[var(--gnosi-primary)] opacity-60" style={{ left: `${String(today)}%` }} title={t('timeline.today', 'Today')} /> : null}
                </div>
                <TimelineDependencies controller={controller} drag={drag} />
                {controller.visibleNotes.map(note => {
                    const title = compactTitle(note, controller, t('common.untitled', 'Untitled'));
                    const selected = controller.isSelected(note.id);
                    const dateStart = note.isParent ? note.summaryStart ?? note.start : note.start;
                    const dateEnd = note.isParent ? note.summaryEnd ?? note.end : note.end;
                    const rangeLabel = `${controller.formatTimelineDate(dateStart)} → ${controller.formatTimelineDate(dateEnd)}`;
                    const toggleSelection = (event: ChangeEvent<HTMLInputElement>) => {
                        const native = event.nativeEvent;
                        controller.toggleSelect(note.id, 'shiftKey' in native && native.shiftKey === true);
                    };
                    return <div key={note.id} data-timeline-row={note.id} className={`group flex border-b border-[var(--border-primary)] hover:bg-[var(--bg-secondary)]/50 ${drag?.targetId === note.id && drag.mode === 'dependency' ? 'bg-[var(--gnosi-primary)]/10' : ''}`} style={{ height: TIMELINE_ROW_HEIGHT }}>
                        <div className={`sticky left-0 z-20 flex shrink-0 items-center gap-1.5 border-r border-[var(--border-primary)] pr-2 ${selected ? 'bg-[var(--bg-secondary)]' : 'bg-[var(--bg-primary)]'}`}
                            style={{ width: controller.columnWidth, paddingLeft: 12 + Math.min(note.depth, 8) * 12 }}>
                            {note.isParent ? <button type="button" className="shrink-0 rounded p-1 hover:bg-[var(--bg-tertiary)]" aria-expanded={!controller.collapsedIds.has(note.id)} aria-label={t('timeline.toggle_group', 'Expand or collapse phase')} onClick={() => { controller.toggleCollapsed(note.id); }}>
                                {controller.collapsedIds.has(note.id) ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                            </button> : <span className="w-5 shrink-0" />}
                            <input type="checkbox" checked={selected} onChange={toggleSelection} aria-label={t('timeline.select_task', 'Select task')} className="h-3.5 w-3.5 shrink-0 accent-[var(--gnosi-primary)]" />
                            <div className="min-w-0 flex-1">
                                <button type="button" className={`block w-full truncate text-left text-xs text-[var(--text-primary)] hover:text-[var(--gnosi-primary)] ${note.isParent ? 'font-bold' : 'font-medium'}`}
                                    {...controller.titlePreview.getTitleProps(note.id)} onClick={() => { onNoteSelect?.(note.id); }} title={timelineTitle(note.title, t('common.untitled', 'Untitled'))}><span className={`text-xs ${note.isParent ? 'font-bold' : 'font-medium'}`}>{title}</span></button>
                                <button type="button" className="block w-full truncate text-left text-[10px] text-[var(--text-tertiary)] hover:text-[var(--gnosi-primary)]" title={rangeLabel}
                                    onClick={() => { if (note.hasDates === false) onNoteSelect?.(note.id); else controller.goToDate(dateStart); }}>
                                    <span className="text-[10px]">{note.hasDates === false ? t('timeline.unscheduled', 'No dates') : `${controller.formatShortDate(dateStart)} → ${controller.formatShortDate(dateEnd)}`}</span>
                                </button>
                            </div>
                            <div className="flex shrink-0 gap-0.5 opacity-0 focus-within:opacity-100 group-hover:opacity-100">
                                <button type="button" aria-label={t('common.open')} onClick={() => { onNoteSelect?.(note.id); }} className="rounded p-1 hover:bg-[var(--bg-tertiary)]"><ExternalLink size={13} /></button>
                                {controller.canEditDependencies && !note.isParent ? <button type="button" title={t('timeline.add_predecessor', 'Add predecessor')} aria-label={t('timeline.add_predecessor', 'Add predecessor')}
                                    disabled={controller.saving} className="rounded p-1 text-[var(--gnosi-primary)] hover:bg-[var(--bg-tertiary)]" onClick={() => { controller.setSelectingPredecessorFor(note.id); }}><Plus size={13} /></button> : null}
                            </div>
                        </div>
                        <div data-timeline-track className="relative flex shrink-0 items-center" style={{ width: controller.scaleMinWidth }}>
                            {note.hasDates !== false && (controller.calculatePosition(dateEnd) / 100 * Number.parseFloat(controller.scaleMinWidth) < scrollLeft
                                || controller.calculatePosition(dateStart) / 100 * Number.parseFloat(controller.scaleMinWidth) > scrollLeft + controller.viewportWidth - controller.columnWidth) ? <button type="button"
                                className="absolute z-10 max-w-40 truncate rounded border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-2 py-1 text-[10px] text-[var(--text-secondary)] hover:text-[var(--gnosi-primary)]"
                                style={{ left: scrollLeft + 8 }} onClick={() => { controller.goToDate(dateStart); }}>
                                {controller.calculatePosition(dateEnd) / 100 * Number.parseFloat(controller.scaleMinWidth) < scrollLeft ? '← ' : '→ '}<span className="text-[10px]">{controller.formatShortDate(dateStart)}</span>
                            </button> : null}
                            {note.hasDates === false ? <button type="button" className="px-4 text-xs text-[var(--text-tertiary)] hover:text-[var(--gnosi-primary)]" onClick={() => { onNoteSelect?.(note.id); }}>{t('timeline.set_dates', 'Set dates')}</button>
                                : <TimelineBar controller={controller} note={note} title={title} drag={drag} begin={begin} consumeClick={consumeClick} onNoteSelect={onNoteSelect} />}
                        </div>
                    </div>;
                })}
                {!controller.chartData.length ? <div className="sticky left-0 flex h-48 flex-col items-center justify-center gap-3 text-sm text-[var(--text-tertiary)]" style={{ width: controller.columnWidth + 320 }}>
                    <Calendar size={32} strokeWidth={1} /><p>{t('timeline.no_data', 'No data to show in the timeline.')}</p>
                </div> : null}
            </div>
        </div>
    </div>;
}
