import { useTranslation } from 'react-i18next';
import { Search, X, SlidersHorizontal, Rows3, LayoutTemplate, Plus } from 'lucide-react';
import { ViewTools } from './ViewTools';
import { NewRecordMenu } from './NewRecordMenu';
import type { ViewActionsProps } from './types';
export function ViewActionsBar(props: ViewActionsProps) {
    const { onAddView, onOpenConfig, searchTerm, setSearchTerm, showSearch, setShowSearch, density, onToggleDensity, activeFilterCount = 0, resultCount = 0, totalCount = 0, presets = [], onSavePreset, onApplyPreset } = props;
    const { t } = useTranslation();
    return (
        <div className="vault-view-actions flex items-center gap-1">
            {(activeFilterCount > 0 || searchTerm) && (
                <div className="vault-view-filter-status" role="status">
                    {activeFilterCount > 0 && (
                        <button type="button" onClick={onOpenConfig ?? undefined} className="vault-view-filter-chip">
                            {t('views_header.active_filters', { count: activeFilterCount })}
                        </button>
                    )}
                    {searchTerm && (
                        <button
                            type="button"
                            onClick={() => setSearchTerm?.('')}
                            className="vault-view-filter-chip"
                            title={t('views_header.clear_search')}
                        >
                            “{searchTerm}” <X size={11} />
                        </button>
                    )}
                    <span className="vault-view-result-count">
                        {t('views_header.filtered_records_count', { count: resultCount, total: totalCount })}
                    </span>
                </div>
            )}
            {showSearch ? (
                <div className="flex items-center gap-1 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-md px-2 py-1">
                    <Search size={12} className="text-[var(--text-tertiary)]" />
                    <input
                        autoFocus
                        type="text"
                        value={searchTerm}
                        onChange={e => setSearchTerm?.(e.target.value)}
                        placeholder={t('common.search_placeholder', "Search...")}
                        className="text-xs outline-none w-28 text-[var(--text-primary)] bg-transparent"
                    />
                    <button
                        type="button"
                        onClick={() => { setSearchTerm?.(''); setShowSearch?.(false); }}
                        className="text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                        title={t('common.close')}
                        aria-label={t('common.close')}
                    >
                        <X size={12} />
                    </button>
                </div>
            ) : (
                <button
                    type="button"
                    onClick={() => setShowSearch?.(true)}
                    className="vault-view-action p-1.5 rounded-md text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors"
                    title={t('views_header.search_title', "Search")}
                    aria-label={t('views_header.search_title', "Search")}
                >
                    <Search size={14} />
                </button>
            )}

            {onOpenConfig && (
                <button
                    type="button"
                    onClick={onOpenConfig}
                    className="vault-view-action flex items-center gap-1.5 px-2 py-1.5 text-xs text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] rounded-md transition-colors"
                    title={t('views_header.view_settings', "View settings")}
                    aria-label={t('views_header.view_settings', "View settings")}
                >
                    <SlidersHorizontal size={13} />
                </button>
            )}

            {onToggleDensity && (
                <button
                    type="button"
                    onClick={onToggleDensity}
                    className="vault-view-action"
                    aria-pressed={density === 'compact'}
                    title={density === 'compact'
                        ? t('views_header.comfortable_density')
                        : t('views_header.compact_density')}
                    aria-label={density === 'compact'
                        ? t('views_header.comfortable_density')
                        : t('views_header.compact_density')}
                >
                    <Rows3 size={14} />
                </button>
            )}

            {onSavePreset && (
                <button
                    type="button"
                    onClick={onSavePreset}
                    className="vault-view-action"
                    title={t('views_header.save_quick_view')}
                    aria-label={t('views_header.save_quick_view')}
                >
                    <LayoutTemplate size={14} />
                </button>
            )}
            {presets.length > 0 && (
                <select
                    value=""
                    onChange={(event) => {
                        if (event.target.value) onApplyPreset?.(event.target.value);
                    }}
                    className="vault-view-preset-select"
                    aria-label={t('views_header.quick_views')}
                >
                    <option value="">{t('views_header.quick_views')}</option>
                    {presets.map((preset) => (
                        <option key={preset.id} value={preset.id}>{preset.label}</option>
                    ))}
                </select>
            )}
            <ViewTools {...props} />
            {onAddView && (
                <button
                    type="button"
                    onClick={onAddView}
                    className="vault-view-action inline-flex items-center justify-center rounded-md text-[var(--text-tertiary)] hover:text-[var(--gnosi-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
                    title={t('views_header.add_view', "Add view")}
                    aria-label={t('views_header.add_view', "Add view")}
                >
                    <Plus size={14} />
                </button>
            )}
            <NewRecordMenu {...props} />
        </div>);
}
