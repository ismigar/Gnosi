import { useState } from 'react';
import { ArrowRight, ChevronLeft, ChevronRight, Plus, Undo2, Scan } from 'lucide-react';
import { Trans, useTranslation } from 'react-i18next';

import { notifyError } from '../../notifications/notifyError';
import { timelineErrorKey, timelineTitle } from './timelineLabels';
import { VaultBulkActionsBar } from '../VaultBulkActionsBar';
import { VaultViewToolbar } from '../VaultViewToolbar';

import type {
    TimelineController,
    TimelineTemplate,
    TimelineZoom,
    VaultTimelineProps,
} from './types';


const ZOOM_LEVELS: readonly TimelineZoom[] = ['day', 'week', 'month'];


interface VaultTimelineControlsProps {
    readonly controller: TimelineController;
    readonly idToTitle: Readonly<Record<string, string>>;
    readonly onApplyTemplate?: (
        selectedIds: Set<string>,
        templateId: string,
    ) => void;
    readonly onCreateRecord?: () => void;
    readonly onDeletePage?: VaultTimelineProps['onDeletePage'];
    readonly onDeleteSelected?: (selectedIds: Set<string>) => void;
    readonly onEditSchema?: (section: string) => void;
    readonly templates: readonly TimelineTemplate[];
}


function ZoomActions({ controller }: { readonly controller: TimelineController }) {
    const { t } = useTranslation();
    return <div className="flex flex-wrap items-center gap-1.5">
        {(['left', 'right'] as const).map(direction => <button key={direction} className="rounded-md border border-[var(--border-primary)] p-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
            aria-label={t(`timeline.scroll_${direction}`, direction === 'left' ? 'Previous period' : 'Next period')}
            onClick={() => { controller.scroll(direction); }} type="button">{direction === 'left' ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}</button>)}
        <div className="flex rounded-md border border-[var(--border-primary)] bg-[var(--bg-tertiary)] p-0.5">
            {ZOOM_LEVELS.map(level => <button key={level} type="button" aria-pressed={controller.zoomLevel === level}
                onClick={() => { controller.setZoomLevel(level); }}
                className={`rounded px-2 py-1 text-xs ${controller.zoomLevel === level ? 'bg-[var(--bg-primary)] font-semibold text-[var(--gnosi-primary)]' : 'text-[var(--text-secondary)]'}`}>{t(`timeline.zoom_${level}`, level)}</button>)}
        </div>
        <button type="button" className="rounded-md border border-[var(--border-primary)] px-2 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]" onClick={controller.goToToday}>{t('timeline.today', 'Today')}</button>
        <button type="button" className="inline-flex items-center gap-1 rounded-md border border-[var(--border-primary)] px-2 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]" onClick={controller.fitProject}><Scan size={13} />{t('timeline.fit_project', 'Fit project')}</button>
        {controller.canEditDependencies ? <button type="button" disabled={!controller.canUndo || controller.saving} aria-label={t('timeline.undo', 'Undo timeline change')} title={t('timeline.undo', 'Undo timeline change')}
            className="rounded-md p-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] disabled:opacity-30"
            onClick={() => { void controller.undo().catch((error: unknown) => { notifyError('timeline-undo', error, t(timelineErrorKey(error))); }); }}><Undo2 size={15} /></button> : null}
        {controller.saving ? <span role="status" className="text-xs text-[var(--text-tertiary)]">{t('timeline.saving', 'Saving…')}</span> : null}
    </div>;
}


function PredecessorDialog({
    controller,
    idToTitle,
}: Pick<VaultTimelineControlsProps, 'controller' | 'idToTitle'>) {
    const { t } = useTranslation();
    const targetId = controller.selectingPredecessorFor;
    if (!targetId) return null;
    return <div className="absolute inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
        <div className="animate-in w-full max-w-md rounded-xl bg-[var(--bg-primary)] p-6 shadow-2xl zoom-in-95 duration-200">
            <h3 className="mb-4 flex items-center gap-2 text-lg font-bold text-[var(--text-primary)]">
                <ArrowRight className="text-[var(--gnosi-primary)]" size={20} />
                {t('timeline.select_predecessor', 'Select a Predecessor')}
            </h3>
            <p className="mb-4 text-sm text-[var(--text-secondary)]">
                <Trans
                    components={{ bold: <strong /> }}
                    defaults="Choose which record must finish before <bold>{{name}}</bold> can start."
                    i18nKey="timeline.predecessor_prompt"
                    values={{ name: idToTitle[targetId] ?? timelineTitle(controller.chartData.find(note => note.id === targetId)?.title, t('common.untitled', 'Untitled')) }}
                />
            </p>
            <div className="max-h-64 overflow-y-auto rounded-lg border border-[var(--border-primary)]">
                {controller.predecessorCandidates.filter(note => !note.isParent).map((note) => <button
                    className="group flex w-full items-center justify-between border-b border-[var(--border-primary)] px-4 py-3 text-left transition-colors last:border-0 hover:bg-[var(--bg-secondary)]"
                    key={note.id}
                    onClick={() => {
                        void controller.handleAddPredecessor(targetId, note.id).catch((error: unknown) => { notifyError('timeline-dependency', error, t(timelineErrorKey(error))); });
                    }}
                    type="button"
                    disabled={controller.saving}
                >
                    <span className="text-sm font-medium text-[var(--text-primary)] group-hover:text-[var(--gnosi-primary)]">
                        {timelineTitle(note.title, t('common.untitled', 'Untitled'))}
                    </span>
                    <span className="text-[10px] text-[var(--text-tertiary)]">
                        {t('timeline.until', 'Until {{date}}', {
                            date: controller.formatTimelineDate(note.end),
                        })}
                    </span>
                </button>)}
            </div>
            <div className="mt-6 flex justify-end">
                <button
                    className="rounded-lg px-4 py-2 text-sm font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-secondary)]"
                    onClick={() => { controller.setSelectingPredecessorFor(null); }}
                    type="button"
                >
                    {t('common.cancel', 'Cancel')}
                </button>
            </div>
        </div>
    </div>;
}


export function VaultTimelineControls({
    controller,
    idToTitle,
    onApplyTemplate,
    onCreateRecord,
    onDeletePage,
    onDeleteSelected,
    onEditSchema,
    templates,
}: VaultTimelineControlsProps) {
    const { t } = useTranslation();
    const [showSearch, setShowSearch] = useState(false);
    return <>
        <PredecessorDialog controller={controller} idToTitle={idToTitle} />
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[var(--border-primary)] p-2">
            {!controller.externalSearch ?
            <VaultViewToolbar
                activeFiltersCount={controller.activeFiltersCount}
                activeSortsCount={controller.activeSortsCount}
                onOpenConfig={onEditSchema ? () => { onEditSchema('settings'); } : undefined}
                onOpenFilters={() => { onEditSchema?.('filters'); }}
                onOpenSort={() => { onEditSchema?.('sorts'); }}
                searchTerm={controller.searchTerm}
                setSearchTerm={controller.setSearchTerm}
                setShowSearch={setShowSearch}
                showSearch={showSearch}
            /> : null}
            <div className="flex flex-wrap items-center gap-2">
                <ZoomActions controller={controller} />
                {onCreateRecord && !controller.externalSearch ? <button
                    className="btn-gnosi inline-flex items-center gap-1.5"
                    onClick={onCreateRecord}
                    type="button"
                >
                    <Plus size={14} />
                    {t('table.new_record', { defaultValue: 'New record' })}
                </button> : null}
            </div>
        </div>
        {controller.selectedIds.size > 0 ? <VaultBulkActionsBar
            onApplyTemplate={onApplyTemplate ? (templateId) => {
                onApplyTemplate(new Set(controller.selectedIds), templateId);
                controller.clearSelection();
            } : null}
            onClearSelection={controller.clearSelection}
            onDeleteSelected={onDeleteSelected || onDeletePage
                ? controller.handleBulkDelete : null}
            onSelectAll={() => {
                controller.selectAll(controller.sortedNotes.map(({ id }) => id));
            }}
            selectedIds={controller.selectedIds}
            templates={templates}
            totalCount={controller.sortedNotes.length}
        /> : null}
    </>;
}
