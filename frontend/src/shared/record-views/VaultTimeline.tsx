import { ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { VaultTimelineControls } from './vault-timeline/VaultTimelineControls';
import { VaultTimelineGrid } from './vault-timeline/VaultTimelineGrid';
import { useVaultTimelineController } from './vault-timeline/useVaultTimelineController';
import type { VaultTimelineProps } from './vault-timeline/types';


export type { VaultTimelineProps } from './vault-timeline/types';


export function VaultTimeline({
    activeView = {},
    allNotes,
    maxHeight,
    idToTitle = {},
    notes = [],
    onApplyTemplate,
    onCreateRecord,
    onDeletePage,
    onDeleteSelected,
    onEditSchema,
    onNoteSelect,
    onUpdateNote,
    schema = {},
    searchTerm,
    templates = [],
}: VaultTimelineProps) {
    const { t } = useTranslation();
    const controller = useVaultTimelineController({
        activeView,
        allNotes,
        notes,
        onDeletePage,
        onDeleteSelected,
        onNoteSelect,
        onUpdateNote,
        schema,
        searchTerm,
    });
    return <div className="relative flex min-h-64 w-full flex-col overflow-hidden bg-[var(--bg-primary)]" style={{ height: maxHeight === 'none' ? 'auto' : maxHeight ?? 'min(65vh, 720px)' }}>
        <VaultTimelineControls
            controller={controller}
            idToTitle={idToTitle}
            onApplyTemplate={onApplyTemplate}
            onCreateRecord={onCreateRecord}
            onDeletePage={onDeletePage}
            onDeleteSelected={onDeleteSelected}
            onEditSchema={onEditSchema}
            templates={templates}
        />
        <VaultTimelineGrid
            controller={controller}
            onNoteSelect={onNoteSelect}
        />
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-2 text-[10px] font-medium text-[var(--text-tertiary)]">
            <div className="flex items-center gap-4">
                <div className="flex items-center gap-1.5">
                    <div className="h-2.5 w-2.5 rounded bg-[var(--gnosi-primary)]" />
                    <span>{t('timeline.legend_page', 'Page / Task')}</span>
                </div>
                <div className="flex items-center gap-1.5 font-bold text-[var(--gnosi-primary)]">
                    <ArrowRight size={10} />
                    <span>{t(
                        'timeline.active_deps',
                        '{{count}} dependencies',
                        { count: controller.chartData.reduce((count, note) => count + controller.getPredecessors(note).length, 0) },
                    )}</span>
                </div>
            </div>
            <div>
                {t(
                    'timeline.footer_hint',
                    'Drag tasks to move them, their edges to resize them, and the connection point to link a successor.',
                )}
            </div>
        </div>
        {controller.titlePreview.preview}
    </div>;
}
