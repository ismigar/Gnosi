
import { VaultTimelineControls } from './vault-timeline/VaultTimelineControls';
import { VaultTimelineFooter } from './vault-timeline/VaultTimelineFooter';
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
    return <div className="relative flex min-h-64 w-full flex-col bg-[var(--bg-primary)]" style={{ height: maxHeight && maxHeight !== 'none' ? maxHeight : 'min(65vh, 720px)' }}>
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
        <VaultTimelineFooter controller={controller} />
        {controller.titlePreview.preview}
    </div>;
}
