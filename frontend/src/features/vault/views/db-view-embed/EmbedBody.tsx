import { VaultViewBody, type VaultViewBodyProps } from '../VaultViewBody';
import { GraphRender } from './GraphRender';
import { TableBox, FeedFlowBox, ScrollBox } from './ViewContainers';
import type { EmbedModel } from './useEmbedController';
import type { EmbedNavigation } from './useEmbedNavigation';
export function EmbedBody({ model, registerNavApi, focusShell }: { model: EmbedModel ;} & Pick<EmbedNavigation, 'registerNavApi' | 'focusShell'>) {
    const { rows, columnsAsKeys, embeddedSchema, ctx, allRows, embeddedView, searchTerm, setSearchTerm, feedGroupMode, block, feedDensity, viewType, templates, reload, table, onEditSchemaAdapter, onCreateRecordAdapter, onDeletePageAdapter, onDeleteSelectedAdapter, onApplyTemplateAdapter, onUpdateViewAdapter, onUpdateNoteAdapter } = model;

    const sharedViewProps: VaultViewBodyProps = {
        notes: rows,
        schema: embeddedSchema,
        idToTitle: ctx.idToTitle,
        allNotes: allRows,
        activeView: embeddedView,
        // Maximum cap on the embedded table/list height: below that, it grows with
        // the content (without empty space); above that it scrolls internally.
        maxHeight: '70vh',
        searchTerm,
        onSearchChange: setSearchTerm,
        feedGroupMode,
        onNoteSelect: (id) => { ctx.onOpenPage?.(id); },
        onCreateRecord: onCreateRecordAdapter,
        onDeletePage: onDeletePageAdapter,
        onDeleteSelected: onDeleteSelectedAdapter,
        onApplyTemplate: (ids, templateId) => { void onApplyTemplateAdapter(ids, templateId); },
        onEditSchema: onEditSchemaAdapter,
        onUpdateView: onUpdateViewAdapter,
        // Editor↔view keyboard navigation bridge. The table/list register the
        // cell navigation; the gallery, the card one (handleShellKeyDown uses it to
        // descend into it with Space/Enter). `onFocusShell` returns focus to the shell
        // (Esc from the gallery records).
        registerNavApi,
        onExitTop: () => ctx.exitEmbedToEditor?.(block?.id, 'up'),
        onExitBottom: () => ctx.exitEmbedToEditor?.(block?.id, 'down'),
        onEscape: focusShell,
        onFocusShell: focusShell,
        feedDensity,
    };
    const renderBody = () => {
        // The `graph` has no equivalent editable component → bespoke render.
        if (viewType === 'graph') return <GraphRender rows={rows} columns={columnsAsKeys} onOpenPage={ctx.onOpenPage} />;
        // The rest of the types are delegated to the shared body (VaultViewBody), which
        // same one used by the full table. The table/list use a
        // container that lets it do the internal scroll (sticky column); the
        // for the rest, a box with its own scroll.
        const Box = (viewType === 'table' || viewType === 'list') ? TableBox
            : (viewType === 'feed') ? FeedFlowBox
                : ScrollBox;
        return (
            <Box>
                <VaultViewBody
                    type={viewType}
                    {...sharedViewProps}
                    templates={templates}
                    isEmbedded={true}
                    onOpenParallel={ctx.onOpenParallel ? id => { ctx.onOpenParallel?.(id); } : undefined}
                    onCellSaved={() => { reload(); }}
                    onTranslated={() => { reload(); }}
                    onUpdateFieldOptions={ctx.onAddSchemaOption}
                    onUpdateNote={onUpdateNoteAdapter}
                    actionRules={table?.action_rules}
                    functionalities={table?.functionalities}
                />
            </Box>
        );
    };
    return renderBody();
}
