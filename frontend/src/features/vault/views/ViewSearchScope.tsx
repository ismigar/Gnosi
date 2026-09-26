import { useTranslation } from 'react-i18next';
import type { ViewSearchScope } from '../../../shared/records/hooks/useViewSearch';

interface Props {
    readonly scope: ViewSearchScope;
    readonly onScopeChange: (scope: ViewSearchScope) => void;
}

export function ViewSearchScopeSelect({ scope, onScopeChange }: Props) {
    const { t } = useTranslation();
    return <select
        value={scope}
        onChange={event => { onScopeChange(event.target.value === 'table' ? 'table' : 'view'); }}
        aria-label={t('views_header.search_scope', 'Search in')}
        className="text-xs bg-[var(--bg-secondary)] text-[var(--text-primary)] border border-[var(--border-primary)] rounded-md px-2 py-1 max-w-40"
    >
        <option value="view">{t('views_header.search_scope_view', 'This view')}</option>
        <option value="table">{t('views_header.search_scope_table', 'Entire table')}</option>
    </select>;
}

export function ViewSearchEmptyState({ scope, onScopeChange }: Props) {
    const { t } = useTranslation();
    return <div className="flex flex-col items-center gap-3 px-4 py-12 text-center text-[var(--text-secondary)]" role="status">
        <p>{scope === 'view'
            ? t('views_header.no_search_results_view', 'No matches in this view. Its filters still apply.')
            : t('views_header.no_search_results_table', 'No matches in this table.')}</p>
        {scope === 'view' && <button type="button" className="btn-gnosi btn-gnosi-primary !text-xs" onClick={() => { onScopeChange('table'); }}>
            {t('views_header.search_entire_table', 'Search the entire table')}
        </button>}
    </div>;
}
