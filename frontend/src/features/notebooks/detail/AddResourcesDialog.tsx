import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, ChevronLeft, ChevronRight, Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import NotebookResourceFilters, { type NotebookResourceFiltersProps } from '../create/NotebookResourceFilters';
import { useModalKeyboard } from '../../../shared/hooks/useModalKeyboard';
import { toast } from '../../../shared/notifications/toast';
import { notifyError } from '../../../shared/notifications/notifyError';
import { addNotebookSources, fetchReferenceResources, type ReferenceResourcePage } from '../../../shared/api/notebooks';
import { isAbortError } from './notebookModel';
import type { ResourceFilters } from './notebookTypes';

interface AddResourcesProps {
    notebookId: string;
    currentIds: ReadonlySet<string>;
    onClose: () => void;
    onAdded: () => Promise<void>;
}
type ResourceData = Pick<ReferenceResourcePage, 'items' | 'total' | 'page' | 'page_size' | 'hidden_without_sources'> & { facets: NotebookResourceFiltersProps['facets'] };

export default function AddResourcesDialog({ notebookId, currentIds, onClose, onAdded }: AddResourcesProps) {
    const { t } = useTranslation();
    const [query, setQuery] = useState('');
    const [data, setData] = useState<ResourceData>({ items: [], total: 0, page: 1, page_size: 50, facets: {}, hidden_without_sources: 0 });
    const [filters, setFilters] = useState<ResourceFilters>({ author: '', tag: '', type: '' });
    const [selected, setSelected] = useState(new Set<string>());
    const [saving, setSaving] = useState(false);
    const dialogRef = useRef<HTMLElement>(null);

    useModalKeyboard({
        isOpen: true,
        onClose,
        closeOnEscape: !saving,
        containerRef: dialogRef,
        trapFocus: true,
    });

    useEffect(() => {
        const controller = new AbortController();
        fetchReferenceResources({
            notebookId,
            query,
            page: data.page,
            pageSize: 50,
            author: filters.author || undefined,
            resourceType: filters.type || undefined,
            tag: filters.tag || undefined,
        }, controller.signal)
            .then((responseData) => { setData({
                items: responseData.items.filter((item) => !currentIds.has(item.id)),
                total: responseData.total || 0,
                page: responseData.page || data.page,
                page_size: responseData.page_size || 50,
                facets: responseData.facets ?? {},
                hidden_without_sources: responseData.hidden_without_sources || 0,
            }); })
            .catch((error: unknown) => {
                if (!isAbortError(error)) notifyError('notebook-resources', error, null, { toast: false, persist: false });
            });
        return () => { controller.abort(); };
    }, [currentIds, data.page, filters, notebookId, query]);

    const pageCount = Math.max(1, Math.ceil(data.total / data.page_size));

    const updateFilter: NotebookResourceFiltersProps['onChange'] = (key, value) => {
        setFilters((previous) => key ? { ...previous, [key]: value } : { author: '', tag: '', type: '' });
        setData((previous) => ({ ...previous, page: 1 }));
    };

    const add = async () => {
        if (!selected.size) return;
        setSaving(true);
        try {
            await addNotebookSources(notebookId, [...selected]);
            toast.success(t('notebooks.resources_added', 'Resources added.'));
            void onAdded();
            onClose();
        } catch {
            toast.error(t('notebooks.resources_add_error', 'Resources could not be added.'));
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="notebook-modal-backdrop">
            <section
                ref={dialogRef}
                className="notebook-modal notebook-modal--compact"
                role="dialog"
                aria-modal="true"
                aria-labelledby="notebook-add-resources-title"
            >
                <header className="notebook-modal__header">
                    <div><h2 id="notebook-add-resources-title">{t('notebooks.add_resources', 'Add Resources')}</h2><p>{t('notebooks.add_resources_help', 'Their attachment and URL fields will be indexed.')}</p></div>
                    <button type="button" className="notebook-icon-button" onClick={onClose} disabled={saving} aria-label={t('common.close', 'Close')}><X size={18} /></button>
                </header>
                <div className="notebook-modal__body">
                    <label className="notebook-search notebook-search--library"><Search size={16} /><input value={query} onChange={(event) => {
                        setQuery(event.target.value);
                        setData((previous) => ({ ...previous, page: 1 }));
                    }} placeholder={t('notebooks.search_resources', 'Search Resources...')} data-autofocus /></label>
                    <NotebookResourceFilters
                        facets={data.facets}
                        filters={filters}
                        onChange={updateFilter}
                        disabled={saving}
                    />
                    {data.hidden_without_sources > 0 && (
                        <p className="notebook-resource-picker__notice" role="status">
                            {t(
                                'notebooks.resources_without_sources_hidden',
                                '{{count}} Resources are not shown because they have no attachments or URLs.',
                                { count: data.hidden_without_sources },
                            )}
                        </p>
                    )}
                    <div className="notebook-resource-picker__list notebook-resource-picker__list--add">
                        {data.items.map((resource) => {
                            const checked = selected.has(resource.id);
                            return <button type="button" key={resource.id} className={`notebook-resource-row ${checked ? 'is-selected' : ''}`} aria-pressed={checked} onClick={() => { setSelected((previous) => {
                                const next = new Set(previous);
                                if (checked) next.delete(resource.id); else next.add(resource.id);
                                return next;
                            }); }}><span className="notebook-resource-row__check">{checked && <CheckCircle2 size={13} />}</span><span className="notebook-resource-row__text"><strong>{resource.title}</strong><small>{t('notebooks.source_count', '{{count}} source(s)', { count: resource.source_count })}</small></span></button>;
                        })}
                    </div>
                    {pageCount > 1 && (
                        <nav className="notebook-pagination notebook-pagination--compact" aria-label={t('notebooks.resource_pagination', 'Resource pages')}>
                            <button type="button" aria-label={t('common.previous', 'Previous')} disabled={data.page <= 1} onClick={() => { setData((previous) => ({ ...previous, page: previous.page - 1 })); }}><ChevronLeft size={15} /></button>
                            <span>{t('notebooks.page_of', 'Page {{page}} of {{pages}}', { page: data.page, pages: pageCount })}</span>
                            <button type="button" aria-label={t('common.next', 'Next')} disabled={data.page >= pageCount} onClick={() => { setData((previous) => ({ ...previous, page: previous.page + 1 })); }}><ChevronRight size={15} /></button>
                        </nav>
                    )}
                </div>
                <footer className="notebook-modal__footer"><button type="button" className="btn-gnosi" disabled={saving} onClick={onClose}>{t('common.cancel', 'Cancel')}</button><button type="button" className="btn-gnosi btn-gnosi-primary" disabled={!selected.size || saving} onClick={() => { void add(); }}>{t('notebooks.add_selected', 'Add selected')}</button></footer>
            </section>
        </div>
    );
}
