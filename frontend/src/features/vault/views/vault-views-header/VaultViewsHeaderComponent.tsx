import { useCallback, useMemo } from 'react';

import { isMainView } from '../viewConstants';
import { HeaderSearchActions } from './HeaderSearchActions';
import { HeaderTitle } from './HeaderTitle';
import { NewRecordMenu } from './NewRecordMenu';
import type {
    HeaderView,
    VaultViewsHeaderProps,
    ViewAction,
} from './types';
import {
    activeViewRecordCount,
    visibleTabViews,
} from './viewModel';
import { ViewTabs } from './ViewTabs';

export function VaultViewsHeader({
    activeViewId,
    brainTableId,
    notes = [],
    onAddView,
    onClose,
    onCreateFromSource,
    onCreateRecord,
    onCreateTemplate,
    onDeleteTemplate,
    onDeleteView,
    onDuplicateTemplate,
    onDuplicateView,
    onEditSchema,
    onEditTemplate,
    onEditView,
    onReferencesImported,
    onRenameView,
    onReorderViews,
    onSetDefaultTemplate,
    onViewSelect,
    recordCount,
    referenceTableId,
    searchTerm,
    setSearchTerm,
    tableName,
    templates = [],
    views,
}: VaultViewsHeaderProps) {
    const viewRecordCount = useMemo(() => activeViewRecordCount(
        notes,
        views,
        activeViewId,
        recordCount,
    ), [activeViewId, notes, recordCount, views]);
    const tabViews = useMemo(() => visibleTabViews(views), [views]);
    const handleViewAction = useCallback((
        view: HeaderView,
        action: ViewAction,
    ): void => {
        if (action === 'configure') {
            if (isMainView(view, views)) return;
            onEditView?.(view);
        }
        if (action === 'delete') {
            if (isMainView(view, views)) return;
            onDeleteView?.(view);
        }
        if (action === 'duplicate') onDuplicateView?.(view);
        if (action === 'rename') onRenameView?.(view);
    }, [
        onDeleteView,
        onDuplicateView,
        onEditView,
        onRenameView,
        views,
    ]);

    return (
        <div className="vault-views-header relative flex flex-col w-full bg-[var(--bg-primary)] shrink-0">
            <HeaderTitle
                brainTableId={brainTableId}
                isFilteredView={viewRecordCount !== recordCount}
                onClose={onClose}
                onReferencesImported={onReferencesImported}
                recordCount={recordCount}
                referenceTableId={referenceTableId}
                tableName={tableName}
                viewRecordCount={viewRecordCount}
            />
            <ViewTabs
                actions={(
                    <>
                        <HeaderSearchActions
                            onEditSchema={onEditSchema}
                            searchTerm={searchTerm}
                            setSearchTerm={setSearchTerm}
                        />
                        <NewRecordMenu
                            onCreateFromSource={onCreateFromSource}
                            onCreateRecord={onCreateRecord}
                            onCreateTemplate={onCreateTemplate}
                            onDeleteTemplate={onDeleteTemplate}
                            onDuplicateTemplate={onDuplicateTemplate}
                            onEditTemplate={onEditTemplate}
                            onSetDefaultTemplate={onSetDefaultTemplate}
                            referenceTableId={referenceTableId}
                            templates={templates}
                        />
                    </>
                )}
                activeViewId={activeViewId}
                onAction={handleViewAction}
                onAddView={onAddView}
                onReorderViews={onReorderViews}
                onViewSelect={onViewSelect}
                tabViews={tabViews}
                views={views}
            />
        </div>
    );
}
