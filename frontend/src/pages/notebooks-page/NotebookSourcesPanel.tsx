import { useTranslation } from 'react-i18next';
import type { NotebookController } from './useNotebookController';
import { CheckCheck, ChevronDown, ChevronLeft, ChevronRight, Folder, FolderPlus, Pencil, Plus, Trash2 } from 'lucide-react';
import NotebookResourceCard from './NotebookResourceCard';

export default function NotebookSourcesPanel({ controller }: { controller: NotebookController }) {
    const { t } = useTranslation();
    const { notebook, mobileTab, useResponsiveTabs, chatOptions, sources, load, selectedSourceIds, collapsedGroupIds, allSourcesSelected, toggleAllSources, toggleCollapse, toggleGroupSources, getGroupSourceIds, setEditingGroup, setShowGroupModal, setShowAdd, handleDeleteGroup } = controller;
    const sourcePageCount = Math.max(1, Math.ceil((sources.total || 0) / (sources.page_size || 50)));
    const customGroups = notebook.groups || [];
    const groupedResourceIds = new Set(customGroups.flatMap((g) => g.resource_ids));
    const ungroupedResources = sources.items.filter((r) => !groupedResourceIds.has(r.resource_id));
    return (
                <aside
                    id="notebook-sources-panel"
                    className={`notebook-sources-panel notebook-mobile-tabpanel ${mobileTab === 'sources' ? 'is-mobile-active' : ''}`}
                    role={useResponsiveTabs ? 'tabpanel' : undefined}
                    aria-labelledby={useResponsiveTabs ? 'notebook-sources-tab' : undefined}
                    hidden={useResponsiveTabs && mobileTab !== 'sources'}
                >
                    <div className="notebook-panel-heading">
                        <div>
                            <h2>{t('notebooks.sources_tab', 'Sources')}</h2>
                            <span>{t('notebooks.resources_sources_summary', '{{resources}} Resources · {{sources}} sources', { resources: notebook.resource_count, sources: notebook.source_counts.total || 0 })}</span>
                        </div>
                        <div className="notebook-panel-heading__actions">
                            {chatOptions.sources.length > 0 && (
                                <button
                                    type="button"
                                    className="notebook-icon-button"
                                    onClick={toggleAllSources}
                                    title={allSourcesSelected ? t('notebooks.clear_source_selection', 'Clear selection') : t('notebooks.select_all_sources', 'Select all sources')}
                                    aria-label={allSourcesSelected ? t('notebooks.clear_source_selection', 'Clear selection') : t('notebooks.select_all_sources', 'Select all sources')}
                                >
                                    <CheckCheck size={17} />
                                </button>
                            )}
                            {notebook.can_manage && (
                                <>
                                    <button
                                        type="button"
                                        className="notebook-icon-button"
                                        onClick={() => { setEditingGroup(null); setShowGroupModal(true); }}
                                        title={t('notebooks.new_group', 'New group')}
                                        aria-label={t('notebooks.new_group', 'New group')}
                                    >
                                        <FolderPlus size={17} />
                                    </button>
                                    <button
                                        type="button"
                                        className="notebook-icon-button"
                                        onClick={() => { setShowAdd(true); }}
                                        title={t('notebooks.add_resources', 'Add Resources')}
                                        aria-label={t('notebooks.add_resources', 'Add Resources')}
                                    >
                                        <Plus size={17} />
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                    <div className="notebook-source-list">
                        {customGroups.map((group) => {
                            const grpSourceIds = getGroupSourceIds(group);
                            const selectedCount = grpSourceIds.filter((id) => selectedSourceIds.has(id)).length;
                            const isAllSelected = grpSourceIds.length > 0 && selectedCount === grpSourceIds.length;
                            const isIndeterminate = selectedCount > 0 && selectedCount < grpSourceIds.length;
                            const isCollapsed = collapsedGroupIds.has(group.id);
                            const groupResources = sources.items.filter((r) =>
                                group.resource_ids.map(String).includes(r.resource_id),
                            );

                            return (
                                <section key={group.id} className="notebook-custom-group">
                                    <header className="notebook-custom-group__header">
                                        <div className="notebook-custom-group__title-row">
                                            <button
                                                type="button"
                                                className="notebook-group-toggle-btn"
                                                onClick={() => { toggleCollapse(group.id); }}
                                                aria-label={isCollapsed ? t('common.expand', 'Expand') : t('common.collapse', 'Collapse')}
                                            >
                                                {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                                            </button>
                                            <input
                                                type="checkbox"
                                                className="notebook-source-checkbox"
                                                checked={isAllSelected}
                                                ref={(element) => {
                                                    if (element) {
                                                        element.indeterminate = isIndeterminate;
                                                    }
                                                }}
                                                onChange={() => { toggleGroupSources(group); }}
                                                aria-label={group.name}
                                            />
                                            <Folder size={13} className="notebook-group-folder-icon" aria-hidden="true" />
                                            <span
                                                className="notebook-group-title"
                                                onClick={() => { toggleCollapse(group.id); }}
                                                role="button"
                                                tabIndex={0}
                                                onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') toggleCollapse(group.id); }}
                                            >
                                                <strong>{group.name}</strong>
                                            </span>
                                            <small className="notebook-group-count-badge">
                                                {t('notebooks.source_count', '{{count}} source(s)', { count: grpSourceIds.length })}
                                            </small>
                                        </div>
                                        {notebook.can_manage && (
                                            <div className="notebook-custom-group__actions">
                                                <button
                                                    type="button"
                                                    className="notebook-icon-button notebook-icon-button--small"
                                                    onClick={() => { setEditingGroup(group); setShowGroupModal(true); }}
                                                    aria-label={t('notebooks.edit_group', 'Edit group')}
                                                >
                                                    <Pencil size={12} />
                                                </button>
                                                <button
                                                    type="button"
                                                    className="notebook-icon-button notebook-icon-button--small"
                                                    onClick={() => { void handleDeleteGroup(group.id); }}
                                                    aria-label={t('notebooks.delete_group', 'Delete group')}
                                                >
                                                    <Trash2 size={12} />
                                                </button>
                                            </div>
                                        )}
                                    </header>
                                    {!isCollapsed && (
                                        <div className="notebook-custom-group__body">
                                            {groupResources.length > 0 ? (
                                                groupResources.map((res) => <NotebookResourceCard key={res.resource_id} resource={res} currentGroupId={group.id} controller={controller} />)
                                            ) : (
                                                <p className="notebook-group-empty-notice">
                                                    {t('notebooks.group_empty', 'No sources in this group.')}
                                                </p>
                                            )}
                                        </div>
                                    )}
                                </section>
                            );
                        })}

                        {ungroupedResources.length > 0 && (
                            <div className="notebook-ungrouped-section">
                                {customGroups.length > 0 && (
                                    <div className="notebook-ungrouped-section__header">
                                        <span>{t('notebooks.ungrouped', 'Ungrouped')}</span>
                                    </div>
                                )}
                                {ungroupedResources.map((res) => <NotebookResourceCard key={res.resource_id} resource={res} currentGroupId={null} controller={controller} />)}
                            </div>
                        )}
                    </div>
                    {sourcePageCount > 1 && (
                        <nav className="notebook-pagination notebook-pagination--panel" aria-label={t('notebooks.source_pagination', 'Source pages')}>
                            <button disabled={sources.page <= 1} onClick={() => { void load({ refresh: false, page: sources.page - 1 }); }}><ChevronLeft size={15} /></button>
                            <span>{t('notebooks.page_of', 'Page {{page}} of {{pages}}', { page: sources.page, pages: sourcePageCount })}</span>
                            <button disabled={sources.page >= sourcePageCount} onClick={() => { void load({ refresh: false, page: sources.page + 1 }); }}><ChevronRight size={15} /></button>
                        </nav>
                    )}
                </aside>

    );
}
