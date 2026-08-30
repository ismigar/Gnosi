import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, ChevronLeft, ChevronRight, Globe2, LoaderCircle, Lock, MessageSquare, Plus, Search, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AppHeader } from '../../../shared/ui/layout/AppHeader';
import { useKeyboardScroll } from '../../../shared/hooks/useKeyboardScroll';
import { useNotebookLibrary } from '../../../shared/api/useNotebookData';
import { toast } from '../../../lib/toast';
import { vaultPath } from '../../../lib/vaultRouting';
import StatusBadge from './StatusBadge';

export default function NotebookLibrary({ onCreate }: { onCreate: () => void }) {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [query, setQuery] = useState('');
    const [debouncedQuery, setDebouncedQuery] = useState('');
    const [page, setPage] = useState(1);
    const scrollContainerRef = useRef<HTMLDivElement>(null);

    useKeyboardScroll(scrollContainerRef);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            setDebouncedQuery(query);
        }, 180);
        return () => { window.clearTimeout(timer); };
    }, [query]);

    const libraryQuery = useNotebookLibrary({ page, pageSize: 24, query: debouncedQuery });
    const data = libraryQuery.data || { items: [], total: 0, page, page_size: 24 };
    const loading = libraryQuery.isFetching;

    useEffect(() => {
        if (!libraryQuery.error) return;
        toast.error(t('notebooks.library_error', 'The notebook library could not be loaded.'));
    }, [libraryQuery.error, t]);

    const pageCount = Math.max(1, Math.ceil((data.total || 0) / (data.page_size || 24)));
    return (
        <div className="notebooks-page">
            <AppHeader
                icon={BookOpen}
                title={t('notebooks.title', 'Notebooks')}
            >
                <button type="button" className="gnosi-button gnosi-button--primary notebooks-primary-action" onClick={onCreate}>
                    <Plus size={16} />
                    {t('notebooks.create_action', 'Create notebook')}
                </button>
            </AppHeader>

            <div className="notebook-library-scroll" ref={scrollContainerRef}>
                <div className="notebook-library">
                    <div className="notebook-library__toolbar">
                        <label className="notebook-search notebook-search--library">
                            <Search size={17} />
                            <input
                                value={query}
                                onChange={(event) => {
                                    setQuery(event.target.value);
                                    setPage(1);
                                }}
                                placeholder={t('notebooks.search_notebooks', 'Search notebooks...')}
                            />
                        </label>
                        <span>{t('notebooks.notebook_count', '{{count}} notebook(s)', { count: data.total || 0 })}</span>
                    </div>

                    {loading && <div className="notebook-library__loading"><LoaderCircle className="animate-spin" /> {t('common.loading', 'Loading...')}</div>}
                    {!loading && !data.items.length && (
                        <div className="notebook-library__empty">
                            <span className="notebook-library__empty-icon"><BookOpen size={30} /></span>
                            <h2>{t('notebooks.empty_title', 'Create your first grounded notebook')}</h2>
                            <p>{t('notebooks.empty_description', 'Choose one or more Resources. Gnosi will index only their attachment and URL fields.')}</p>
                            <button className="btn-gnosi btn-gnosi-primary" onClick={onCreate}>{t('notebooks.create_action', 'Create notebook')}</button>
                        </div>
                    )}
                    <div className="notebook-grid">
                        {data.items.map((notebook) => (
                            <button key={notebook.id} className="notebook-card" onClick={() => { void navigate(vaultPath('notebooks', notebook.id)); }}>
                                <div className="notebook-card__top">
                                    <span className="notebook-card__icon"><BookOpen size={19} /></span>
                                    <StatusBadge status={notebook.status} />
                                </div>
                                <h2>{notebook.title}</h2>
                                <p>{t('notebooks.card_counts', '{{resources}} Resources · {{sources}} available sources', {
                                    resources: notebook.resource_count || 0,
                                    sources: notebook.source_counts.available || 0,
                                    })}</p>
                                <div className="notebook-card__meta">
                                    <span>{notebook.visibility === 'private' ? <Lock size={13} /> : <Globe2 size={13} />}{t(`notebooks.visibility_${notebook.visibility}`, notebook.visibility)}</span>
                                    <span>{notebook.conversation_mode === 'shared' ? <Users size={13} /> : <MessageSquare size={13} />}{t(`notebooks.conversation_${notebook.conversation_mode === 'shared' ? 'shared' : 'private'}`, notebook.conversation_mode)}</span>
                                </div>
                            </button>
                        ))}
                    </div>

                    {pageCount > 1 && (
                        <nav className="notebook-pagination" aria-label={t('notebooks.pagination', 'Notebook pages')}>
                            <button disabled={data.page <= 1} onClick={() => { setPage((previous) => previous - 1); }}><ChevronLeft size={16} /></button>
                            <span>{t('notebooks.page_of', 'Page {{page}} of {{pages}}', { page: data.page, pages: pageCount })}</span>
                            <button disabled={data.page >= pageCount} onClick={() => { setPage((previous) => previous + 1); }}><ChevronRight size={16} /></button>
                        </nav>
                    )}
                </div>
            </div>
        </div>
    );
}
