import { VaultViewBody, type VaultViewBodyProps } from '../VaultViewBody';
import { GraphRender } from './GraphRender';
import { EmbeddedViewBox } from './ViewContainers';
import { viewHeightMode } from '../../../../shared/records/model/viewHeight';
import type { EmbedModel } from './useEmbedController';
import type { EmbedNavigation } from './useEmbedNavigation';
import { ViewSearchEmptyState } from '../ViewSearchScope';
export function EmbedBody({ model, registerNavApi, focusShell }: { model: EmbedModel ;} & Pick<EmbedNavigation, 'registerNavApi' | 'focusShell'>) {
    const { rows, columnsAsKeys, embeddedSchema, ctx, allRows, embeddedView, searchTerm, setSearchTerm, feedGroupMode, block, feedDensity, viewType, templates, reload, table, onEditSchemaAdapter, onCreateRecordAdapter, onDeletePageAdapter, onDeleteSelectedAdapter, onApplyTemplateAdapter, onUpdateViewAdapter, onUpdateNoteAdapter } = model;
    const heightMode = viewHeightMode(embeddedView.heightMode, viewType);
    if (searchTerm.trim() && rows.length === 0 && viewType !== 'genogram') {
        return <ViewSearchEmptyState scope={model.searchScope} onScopeChange={model.setSearchScope} />;
    }

    const sharedViewProps: VaultViewBodyProps = {
        notes: rows,
        schema: embeddedSchema,
        idToTitle: ctx.idToTitle,
        allNotes: allRows,
        activeView: embeddedView,
        // Maximum cap on the embedded table/list height: below that, it grows with
        // the content (without empty space); above that it scrolls internally.
        maxHeight: heightMode === 'content' ? 'none' : '70vh',
        searchTerm,
        onSearchChange: setSearchTerm,
        feedGroupMode,
        onNoteSelect: (id) => { ctx.onOpenPage?.(id); },
        onOpenParallel: ctx.onOpenParallel ?? undefined,
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
        return (
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
        );
    };
    return <EmbeddedViewBox viewType={viewType} heightMode={heightMode}>{renderBody()}</EmbeddedViewBox>;
}
