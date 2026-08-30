import { ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { VaultTimelineControls } from './vault-timeline/VaultTimelineControls';
import { VaultTimelineGrid } from './vault-timeline/VaultTimelineGrid';
import { useVaultTimelineController } from './vault-timeline/useVaultTimelineController';
import type { VaultTimelineProps } from './vault-timeline/types';


export type { VaultTimelineProps } from './vault-timeline/types';


export function VaultTimeline({
    activeView = {},
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
        notes,
        onDeletePage,
        onDeleteSelected,
        onNoteSelect,
        onUpdateNote,
        schema,
        searchTerm,
    });
    return <div className="relative flex h-full w-full flex-col overflow-hidden bg-[var(--bg-primary)]">
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
        <div className="flex items-center justify-between border-t border-[var(--border-primary)] bg-[var(--bg-primary)] px-6 py-2 text-[10px] font-medium text-[var(--text-tertiary)]">
            <div className="flex items-center gap-4">
                <div className="flex items-center gap-1.5">
                    <div className="h-2.5 w-2.5 rounded bg-[var(--gnosi-primary)]" />
                    <span>{t('timeline.legend_page', 'Page / Task')}</span>
                </div>
                <div className="flex items-center gap-1.5 font-bold text-[var(--gnosi-primary)]">
                    <ArrowRight size={10} />
                    <span>{t(
                        'timeline.active_deps',
                        'Active dependencies ({{count}} records)',
                        { count: controller.chartData.length },
                    )}</span>
                </div>
            </div>
            <div>
                {t(
                    'timeline.footer_hint',
                    'Interactive timeline with automatic dependencies.',
                )}
            </div>
        </div>
        {controller.titlePreview.preview}
    </div>;
}
