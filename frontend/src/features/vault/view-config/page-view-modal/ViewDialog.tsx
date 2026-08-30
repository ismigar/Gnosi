import { X, Eye } from 'lucide-react';
import { TABS } from './constants';
import { ViewIdentity } from './ViewIdentity';
import { ViewJoins } from './ViewJoins';
import { ViewTypePicker } from './ViewTypePicker';
import { ViewReadingOptions } from './ViewReadingOptions';
import { ViewGalleryOptions } from './ViewGalleryOptions';
import { ViewDateOptions } from './ViewDateOptions';
import { ViewChartOptions } from './ViewChartOptions';
import { ViewRegistryOptions } from './ViewRegistryOptions';
import { ViewSnapshotOptions } from './ViewSnapshotOptions';
import { ViewColumns } from './ViewColumns';
import { ViewFilters } from './ViewFilters';
import { ViewSort } from './ViewSort';
import { ViewGrouping } from './ViewGrouping';
import { ViewFooter } from './ViewFooter';
import { ViewConfirmations } from './ViewConfirmations';
import { ViewExistingPicker } from './ViewExistingPicker';

import type { RefObject } from 'react';
import type { useViewController } from './useViewController';
type ViewData = Omit<ReturnType<typeof useViewController>, 'panelRef'>;

export function ViewDialog({ panelRef, view }: { panelRef: RefObject<HTMLDivElement | null>; view: ViewData }) {
    const { isTableMode, editingView, t, editingBlock, requestClose, activeTab, setActiveTab, error } = view;
    return (<>        <div
        className="fixed inset-0 bg-black/60 flex items-center justify-center z-[var(--z-modal)] p-4 backdrop-blur-sm"
    >
        <div ref={panelRef} className="bg-[var(--bg-primary)] rounded-xl shadow-2xl w-full max-w-2xl border border-[var(--border-primary)] flex flex-col max-h-[85vh]" role="dialog" aria-modal="true" aria-labelledby="page-view-modal-title">
            {/* Header */}
            <div className="px-5 py-4 border-b border-[var(--border-primary)] flex justify-between items-center bg-[var(--bg-secondary)] rounded-t-xl shrink-0">
                <h2 id="page-view-modal-title" className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
                    <Eye size={16} className="text-[var(--gnosi-primary)]" />
                    {isTableMode
                        ? (editingView?.id ? t('view.config_title', "Configure view") : t('view.new_view', "New view"))
                        : (editingBlock
                            ? t('page_view.title_edit', "Edit database view")
                            : t('page_view.title', "Add database view"))}
                </h2>
                <button type="button" onClick={() => { requestClose(); }} className="gnosi-close-btn" aria-label={t('common.close', 'Close')}>
                    <X size={16} />
                </button>
            </div>

            {/* Existing View Dropdown - Moved to the top for better UX */}
            <ViewExistingPicker {...view} />

            {/* Tabs */}
            <div className="flex border-b border-[var(--border-primary)] bg-[var(--bg-secondary)] shrink-0">
                {TABS.map(tab => {
                    const Icon = tab.icon;
                    const active = activeTab === tab.id;
                    return (
                        <button
                            key={tab.id}
                            onClick={() => { setActiveTab(tab.id); }}
                            className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold border-b-2 transition-colors ${active
                                    ? 'border-[var(--gnosi-primary)] text-[var(--gnosi-primary)]'
                                    : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                                }`}
                        >
                            <Icon size={13} />
                            {t(`view.tab_${tab.id}`, tab.label)}
                        </button>
                    );
                })}
            </div>

            {/* Body */}
            <div className="p-5 space-y-4 overflow-y-auto flex-1">
                {activeTab === 'general' && (
                    <>
                        {/* View name — first field in General, shown in both
                                modes. In embed mode the name is only used when
                                "saveToTableViews" is checked, but showing it here
                                keeps the layout consistent and lets the user name
                                the view before configuring the rest. */}
                        <ViewIdentity {...view} />

                        {/* Multi-table joins. Visible in both modes (the base
                                table is fixed in table mode but joins are still
                                configurable). Each join chains a new table onto
                                the previous one via a pair of fields. */}
                        <ViewJoins {...view} />

                        <ViewTypePicker {...view} />

                        {/* Type-specific options for the chosen view type: they appear
                                contextually right below the type selector. */}
                        <ViewReadingOptions {...view} />
                        <ViewGalleryOptions {...view} />

                        <ViewDateOptions {...view} />

                        <ViewChartOptions {...view} />



                        <ViewRegistryOptions {...view} />

                        {/* Portability: snapshot of result wikilinks into
                                markdown (Obsidian/Drupal/plain readers). The value
                                lives in the view; the backend honors it when saving. */}
                        <ViewSnapshotOptions {...view} />
                    </>
                )}

                <ViewColumns {...view} />

                <ViewFilters {...view} />

                <ViewSort {...view} />

                <ViewGrouping {...view} />

                {error && (
                    <p className="text-xs text-red-500 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">
                        {error}
                    </p>
                )}
            </div>

            {/* Footer: the primary action persists; Cancel discards local edits. */}
            <ViewFooter {...view} />
        </div>
        <ViewConfirmations {...view} />
    </div></>);
}
