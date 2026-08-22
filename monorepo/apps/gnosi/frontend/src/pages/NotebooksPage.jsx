import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
    AlertCircle,
    ArrowLeft,
    BookOpen,
    CheckCircle2,
    ChevronLeft,
    ChevronRight,
    CircleStop,
    Globe2,
    LoaderCircle,
    Lock,
    MessageSquare,
    Plus,
    RefreshCw,
    Search,
    Settings2,
    Trash2,
    Users,
    X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import AgentChat from '../components/AgentChat';
import { AppHeader } from '../components/AppHeader';
import ConfirmModal from '../components/ConfirmModal';
import NotebookCreateDialog from '../components/Notebooks/NotebookCreateDialog';
import NotebookResourceFilters from '../components/Notebooks/NotebookResourceFilters';
import {
    EMPTY_RESOURCE_FACETS,
    EMPTY_RESOURCE_FILTERS,
    normalizeResourceFacets,
    notebookResourceCatalogUrl,
} from '../components/Notebooks/notebookResourceCatalog';
import { useModalKeyboard } from '../hooks/useModalKeyboard';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { toast } from '../lib/toast';
import './NotebooksPage.css';

const ACTIVE_STATES = new Set(['queued', 'indexing']);
const MOBILE_TAB_IDS = ['sources', 'chat', 'settings'];

function StatusBadge({ status }) {
    const { t } = useTranslation();
    const icon = {
        pending: <LoaderCircle size={13} className="animate-spin" />,
        indexing: <LoaderCircle size={13} className="animate-spin" />,
        available: <CheckCircle2 size={13} />,
        stale: <RefreshCw size={13} />,
        error: <AlertCircle size={13} />,
    }[status] || <LoaderCircle size={13} />;
    return (
        <span className={`notebook-status notebook-status--${status || 'pending'}`}>
            {icon}
            {t(`notebooks.status.${status || 'pending'}`, status || 'Pending')}
        </span>
    );
}

function NotebookLibrary({ onCreate }) {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [query, setQuery] = useState('');
    const [data, setData] = useState({ items: [], total: 0, page: 1, page_size: 24 });
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const controller = new AbortController();
        const timer = window.setTimeout(() => {
            setLoading(true);
            fetch(`/api/notebooks?q=${encodeURIComponent(query)}&page=${data.page}&page_size=24`, { signal: controller.signal })
                .then((response) => response.ok ? response.json() : Promise.reject(new Error(`Notebook library failed (${response.status})`)))
                .then(setData)
                .catch((error) => {
                    if (error.name !== 'AbortError') {
                        console.error('Could not load notebook library', error);
                        toast.error(t('notebooks.library_error', 'The notebook library could not be loaded.'));
                    }
                })
                .finally(() => setLoading(false));
        }, 180);
        return () => {
            window.clearTimeout(timer);
            controller.abort();
        };
    }, [data.page, query, t]);

    const pageCount = Math.max(1, Math.ceil((data.total || 0) / (data.page_size || 24)));
    return (
        <div className="notebooks-page">
            <AppHeader
                icon={BookOpen}
                title={t('notebooks.title', 'Notebooks')}
                subtitle={t('notebooks.subtitle', 'Converse with the attachments and URLs in your Resources.')}
            >
                <button type="button" className="gnosi-button gnosi-button--primary notebooks-primary-action" onClick={onCreate}>
                    <Plus size={16} />
                    {t('notebooks.create_action', 'Create notebook')}
                </button>
            </AppHeader>

            <div className="notebook-library">
                <div className="notebook-library__toolbar">
                    <label className="notebook-search notebook-search--library">
                        <Search size={17} />
                        <input
                            value={query}
                            onChange={(event) => {
                                setQuery(event.target.value);
                                setData((previous) => ({ ...previous, page: 1 }));
                            }}
                            placeholder={t('notebooks.search_notebooks', 'Search notebooks...')}
                        />
                    </label>
                    <span>{t('notebooks.notebook_count', '{{count}} notebook(s)', { count: data.total || 0 })}</span>
                </div>

                {loading && <div className="notebook-library__loading"><LoaderCircle className="animate-spin" /> {t('common.loading', 'Loading...')}</div>}
                {!loading && !data.items?.length && (
                    <div className="notebook-library__empty">
                        <span className="notebook-library__empty-icon"><BookOpen size={30} /></span>
                        <h2>{t('notebooks.empty_title', 'Create your first grounded notebook')}</h2>
                        <p>{t('notebooks.empty_description', 'Choose one or more Resources. Gnosi will index only their attachment and URL fields.')}</p>
                        <button className="btn-gnosi btn-gnosi-primary" onClick={onCreate}>{t('notebooks.create_action', 'Create notebook')}</button>
                    </div>
                )}
                <div className="notebook-grid">
                    {(data.items || []).map((notebook) => (
                        <button key={notebook.id} className="notebook-card" onClick={() => navigate(`/notebooks/${notebook.id}`)}>
                            <div className="notebook-card__top">
                                <span className="notebook-card__icon"><BookOpen size={19} /></span>
                                <StatusBadge status={notebook.status} />
                            </div>
                            <h2>{notebook.title}</h2>
                            <p>{t('notebooks.card_counts', '{{resources}} Resources · {{sources}} available sources', {
                                resources: notebook.resource_count || 0,
                                sources: notebook.source_counts?.available || 0,
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
                        <button disabled={data.page <= 1} onClick={() => setData((previous) => ({ ...previous, page: previous.page - 1 }))}><ChevronLeft size={16} /></button>
                        <span>{t('notebooks.page_of', 'Page {{page}} of {{pages}}', { page: data.page, pages: pageCount })}</span>
                        <button disabled={data.page >= pageCount} onClick={() => setData((previous) => ({ ...previous, page: previous.page + 1 }))}><ChevronRight size={16} /></button>
                    </nav>
                )}
            </div>
        </div>
    );
}

function AddResourcesDialog({ notebookId, currentIds, onClose, onAdded }) {
    const { t } = useTranslation();
    const [query, setQuery] = useState('');
    const [data, setData] = useState({ items: [], total: 0, page: 1, page_size: 50, facets: EMPTY_RESOURCE_FACETS, hidden_without_sources: 0 });
    const [filters, setFilters] = useState({ ...EMPTY_RESOURCE_FILTERS });
    const [selected, setSelected] = useState(new Set());
    const [saving, setSaving] = useState(false);
    const dialogRef = useRef(null);
    useModalKeyboard({
        isOpen: true,
        onClose,
        closeOnEscape: !saving,
        containerRef: dialogRef,
        trapFocus: true,
    });
    useEffect(() => {
        const controller = new AbortController();
        fetch(notebookResourceCatalogUrl({
            notebookId,
            query,
            page: data.page,
            filters,
        }), { signal: controller.signal })
            .then((response) => response.ok ? response.json() : Promise.reject(new Error(`Resource list failed (${response.status})`)))
            .then((responseData) => setData({
                items: (responseData.items || []).filter((item) => !currentIds.has(String(item.id))),
                total: Number(responseData.total) || 0,
                page: Number(responseData.page) || data.page,
                page_size: Number(responseData.page_size) || 50,
                facets: normalizeResourceFacets(responseData.facets),
                hidden_without_sources: Number(responseData.hidden_without_sources) || 0,
            }))
            .catch((error) => { if (error.name !== 'AbortError') console.error('Could not load Resources', error); });
        return () => controller.abort();
    }, [currentIds, data.page, filters, notebookId, query]);
    const pageCount = Math.max(1, Math.ceil(data.total / data.page_size));
    const updateFilter = (key, value) => {
        setFilters((previous) => key ? { ...previous, [key]: value } : { ...EMPTY_RESOURCE_FILTERS });
        setData((previous) => ({ ...previous, page: 1 }));
    };
    const add = async () => {
        if (!selected.size) return;
        setSaving(true);
        try {
            const response = await fetch(`/api/notebooks/${encodeURIComponent(notebookId)}/sources`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ resource_ids: [...selected] }),
            });
            if (!response.ok) throw new Error(`Resource addition failed (${response.status})`);
            toast.success(t('notebooks.resources_added', 'Resources added.'));
            onAdded();
            onClose();
        } catch (error) {
            console.error('Could not add notebook Resources', error);
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
                            const checked = selected.has(String(resource.id));
                            return <button type="button" key={resource.id} className={`notebook-resource-row ${checked ? 'is-selected' : ''}`} aria-pressed={checked} onClick={() => setSelected((previous) => {
                                const next = new Set(previous);
                                if (checked) next.delete(String(resource.id)); else next.add(String(resource.id));
                                return next;
                            })}><span className="notebook-resource-row__check">{checked && <CheckCircle2 size={13} />}</span><span className="notebook-resource-row__text"><strong>{resource.title}</strong><small>{t('notebooks.source_count', '{{count}} source(s)', { count: resource.source_count })}</small></span></button>;
                        })}
                    </div>
                    {pageCount > 1 && (
                        <nav className="notebook-pagination notebook-pagination--compact" aria-label={t('notebooks.resource_pagination', 'Resource pages')}>
                            <button type="button" aria-label={t('common.previous', 'Previous')} disabled={data.page <= 1} onClick={() => setData((previous) => ({ ...previous, page: previous.page - 1 }))}><ChevronLeft size={15} /></button>
                            <span>{t('notebooks.page_of', 'Page {{page}} of {{pages}}', { page: data.page, pages: pageCount })}</span>
                            <button type="button" aria-label={t('common.next', 'Next')} disabled={data.page >= pageCount} onClick={() => setData((previous) => ({ ...previous, page: previous.page + 1 }))}><ChevronRight size={15} /></button>
                        </nav>
                    )}
                </div>
                <footer className="notebook-modal__footer"><button type="button" className="btn-gnosi" disabled={saving} onClick={onClose}>{t('common.cancel', 'Cancel')}</button><button type="button" className="btn-gnosi btn-gnosi-primary" disabled={!selected.size || saving} onClick={add}>{t('notebooks.add_selected', 'Add selected')}</button></footer>
            </section>
        </div>
    );
}

export function NotebookDetail({ notebookId }) {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [notebook, setNotebook] = useState(null);
    const [sources, setSources] = useState({ items: [], total: 0, page: 1, page_size: 50 });
    const [loading, setLoading] = useState(true);
    const [mobileTab, setMobileTab] = useState('sources');
    const [showAdd, setShowAdd] = useState(false);
    const [showDelete, setShowDelete] = useState(false);
    const [showClear, setShowClear] = useState(false);
    const [chatEpoch, setChatEpoch] = useState(0);
    const [removingId, setRemovingId] = useState('');
    const [retryingId, setRetryingId] = useState('');
    const [cancelling, setCancelling] = useState(false);
    const mobileTabRefs = useRef({});
    const useResponsiveTabs = useMediaQuery('(max-width: 1120px)');

    const selectMobileTabFromKeyboard = (event, currentTab) => {
        const currentIndex = MOBILE_TAB_IDS.indexOf(currentTab);
        let nextIndex = null;
        if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % MOBILE_TAB_IDS.length;
        if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + MOBILE_TAB_IDS.length) % MOBILE_TAB_IDS.length;
        if (event.key === 'Home') nextIndex = 0;
        if (event.key === 'End') nextIndex = MOBILE_TAB_IDS.length - 1;
        if (nextIndex === null) return;
        event.preventDefault();
        const nextTab = MOBILE_TAB_IDS[nextIndex];
        setMobileTab(nextTab);
        mobileTabRefs.current[nextTab]?.focus();
    };

    const load = useCallback(async ({ refresh = false, page = sources.page } = {}) => {
        try {
            const sourceUrl = `/api/notebooks/${encodeURIComponent(notebookId)}/sources?page=${page}&page_size=50`;
            const [notebookResponse, sourceResponse] = await Promise.all([
                fetch(`/api/notebooks/${encodeURIComponent(notebookId)}?refresh=${refresh ? 'true' : 'false'}`),
                fetch(sourceUrl),
            ]);
            if (notebookResponse.status === 404) {
                navigate('/notebooks', { replace: true });
                return;
            }
            if (!notebookResponse.ok || !sourceResponse.ok) throw new Error('Notebook detail failed');
            const notebookData = await notebookResponse.json();
            let sourceData = await sourceResponse.json();
            if (
                notebookData.active_revision !== null
                && notebookData.active_revision !== sourceData.active_revision
            ) {
                const currentSourcesResponse = await fetch(sourceUrl);
                if (currentSourcesResponse.ok) sourceData = await currentSourcesResponse.json();
            }
            setNotebook(notebookData);
            setSources(sourceData);
        } catch (error) {
            console.error('Could not load notebook', error);
            toast.error(t('notebooks.detail_error', 'The notebook could not be loaded.'));
        } finally {
            setLoading(false);
        }
    }, [navigate, notebookId, sources.page, t]);

    useEffect(() => { void load({ refresh: true }); }, [notebookId]); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => {
        if (!notebook || !ACTIVE_STATES.has(notebook.progress?.state)) return undefined;
        const timer = window.setInterval(() => {
            if (document.visibilityState === 'visible') void load({ refresh: false });
        }, 1500);
        return () => window.clearInterval(timer);
    }, [load, notebook]);

    const patchNotebook = async (patch) => {
        const response = await fetch(`/api/notebooks/${encodeURIComponent(notebookId)}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
        });
        if (!response.ok) {
            toast.error(t('notebooks.settings_error', 'Notebook settings could not be saved.'));
            return;
        }
        setNotebook(await response.json());
    };
    const refresh = async () => {
        try {
            const response = await fetch(`/api/notebooks/${encodeURIComponent(notebookId)}/refresh`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ force: true, reason: 'manual' }),
            });
            if (!response.ok) throw new Error(`Notebook refresh failed (${response.status})`);
            toast.success(t('notebooks.refresh_started', 'Refresh started.'));
            void load({ refresh: false });
        } catch (error) {
            console.error('Could not refresh notebook', error);
            toast.error(t('notebooks.refresh_error', 'The notebook refresh could not be started.'));
        }
    };
    const retryResource = async (resourceId) => {
        setRetryingId(resourceId);
        try {
            const response = await fetch(
                `/api/notebooks/${encodeURIComponent(notebookId)}/sources/${encodeURIComponent(resourceId)}/refresh`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ force: true, reason: 'resource_retry' }),
                },
            );
            if (!response.ok) throw new Error(`Resource retry failed (${response.status})`);
            toast.success(t('notebooks.resource_retry_started', 'Resource retry started.'));
            await load({ refresh: false });
        } catch (error) {
            console.error('Could not retry notebook Resource', error);
            toast.error(t('notebooks.resource_retry_error', 'The Resource retry could not be started.'));
        } finally {
            setRetryingId('');
        }
    };
    const cancelRefresh = async () => {
        setCancelling(true);
        try {
            const response = await fetch(`/api/notebooks/${encodeURIComponent(notebookId)}/refresh/cancel`, { method: 'POST' });
            if (!response.ok) throw new Error(`Notebook cancellation failed (${response.status})`);
            setNotebook(await response.json());
            toast.success(t('notebooks.index_cancelled', 'Indexing cancelled.'));
            await load({ refresh: false });
        } catch (error) {
            console.error('Could not cancel notebook indexing', error);
            toast.error(t('notebooks.index_cancel_error', 'Indexing could not be cancelled.'));
        } finally {
            setCancelling(false);
        }
    };
    const remove = async (resourceId) => {
        setRemovingId(resourceId);
        try {
            const response = await fetch(`/api/notebooks/${encodeURIComponent(notebookId)}/sources/${encodeURIComponent(resourceId)}`, { method: 'DELETE' });
            if (!response.ok) throw new Error('Removal failed');
            toast.success(t('notebooks.resource_removed', 'Resource removed from the notebook.'));
            await load({ refresh: false });
        } catch (error) {
            console.error('Could not remove Resource', error);
            toast.error(t('notebooks.resource_remove_error', 'The Resource could not be removed.'));
        } finally { setRemovingId(''); }
    };
    const deleteNotebook = async () => {
        const response = await fetch(`/api/notebooks/${encodeURIComponent(notebookId)}`, { method: 'DELETE' });
        if (response.ok) {
            toast.success(t('notebooks.deleted', 'Notebook deleted.'));
            navigate('/notebooks');
        }
    };
    const clearConversation = async () => {
        const response = await fetch(
            `/api/chat/sessions/gnosy/${encodeURIComponent(notebook.conversation_session_id)}?notebook_id=${encodeURIComponent(notebook.id)}`,
            { method: 'DELETE' },
        );
        if (response.ok) {
            setShowClear(false);
            setChatEpoch((value) => value + 1);
            toast.success(t('notebooks.conversation_cleared', 'Conversation cleared.'));
            return;
        }
        toast.error(t('notebooks.conversation_clear_error', 'The conversation could not be cleared.'));
    };
    const currentIds = useMemo(() => new Set((sources.items || []).map((item) => String(item.resource_id))), [sources.items]);

    if (loading || !notebook) return <div className="notebooks-page notebook-detail-loading"><LoaderCircle className="animate-spin" /> {t('common.loading', 'Loading...')}</div>;
    const sourcePageCount = Math.max(1, Math.ceil((sources.total || 0) / (sources.page_size || 50)));
    const chatContext = [{ id: `notebook:${notebook.id}`, type: 'notebook', ref: notebook.id, label: notebook.title, scope: {} }];
    return (
        <div className="notebook-detail">
            <header className="notebook-detail__header">
                <button className="notebook-icon-button" onClick={() => navigate('/notebooks')} aria-label={t('notebooks.back_library', 'Back to library')}><ArrowLeft size={19} /></button>
                <div className="notebook-detail__identity">
                    <input value={notebook.title} onChange={(event) => setNotebook((previous) => ({ ...previous, title: event.target.value }))} onBlur={(event) => patchNotebook({ title: event.target.value })} aria-label={t('notebooks.title_label', 'Title')} />
                    <div><StatusBadge status={notebook.status} /><span>{t('notebooks.revision_label', 'Revision {{revision}}', { revision: notebook.active_revision || '—' })}</span></div>
                </div>
                <div className="notebook-detail__actions">
                    {notebook.can_manage && <button className="btn-gnosi" onClick={refresh}><RefreshCw size={15} />{t('notebooks.refresh', 'Refresh')}</button>}
                    {notebook.can_manage && <button className="notebook-icon-button notebook-icon-button--danger" onClick={() => setShowDelete(true)} aria-label={t('notebooks.delete', 'Delete notebook')}><Trash2 size={17} /></button>}
                </div>
            </header>

            {notebook.progress && ACTIVE_STATES.has(notebook.progress.state) && (
                <div className="notebook-progress">
                    <div className="notebook-progress__summary">
                        <div role="status" aria-live="polite" aria-atomic="true"><LoaderCircle size={15} className="animate-spin" /><span>{t('notebooks.index_progress', 'Indexing {{processed}} of {{total}} Resources', notebook.progress)}</span></div>
                        {notebook.can_manage && notebook.progress.cancellable && <button type="button" disabled={cancelling} onClick={cancelRefresh}><CircleStop size={14} />{t('notebooks.cancel_indexing', 'Cancel indexing')}</button>}
                    </div>
                    {notebook.progress.current_resource_title && <span className="notebook-progress__resource">{t('notebooks.current_resource', 'Current Resource: {{resource}}', { resource: notebook.progress.current_resource_title })}</span>}
                    <div className="notebook-progress__track"><span style={{ width: `${notebook.progress.percent || 0}%` }} /></div>
                </div>
            )}
            {notebook.last_error && <div className="notebook-warning" role="alert"><AlertCircle size={16} /><span>{notebook.last_error}</span></div>}

            <div
                className="notebook-mobile-tabs"
                role="tablist"
                aria-label={t('notebooks.mobile_tabs_label', 'Notebook sections')}
            >
                {MOBILE_TAB_IDS.map((tabId) => {
                    const labels = {
                        sources: t('notebooks.sources_tab', 'Sources'),
                        chat: t('notebooks.chat_tab', 'Conversation'),
                        settings: t('notebooks.settings_tab', 'Settings'),
                    };
                    const icons = { sources: BookOpen, chat: MessageSquare, settings: Settings2 };
                    const Icon = icons[tabId];
                    const selected = mobileTab === tabId;
                    return (
                        <button
                            key={tabId}
                            id={`notebook-${tabId}-tab`}
                            ref={(element) => { mobileTabRefs.current[tabId] = element; }}
                            type="button"
                            role="tab"
                            aria-selected={selected}
                            aria-controls={`notebook-${tabId}-panel`}
                            tabIndex={selected ? 0 : -1}
                            className={selected ? 'is-active' : ''}
                            onClick={() => setMobileTab(tabId)}
                            onKeyDown={(event) => selectMobileTabFromKeyboard(event, tabId)}
                        >
                            <Icon size={15} aria-hidden="true" />
                            {labels[tabId]}
                        </button>
                    );
                })}
            </div>

            <div className="notebook-workspace">
                <aside
                    id="notebook-sources-panel"
                    className={`notebook-sources-panel notebook-mobile-tabpanel ${mobileTab === 'sources' ? 'is-mobile-active' : ''}`}
                    role={useResponsiveTabs ? 'tabpanel' : undefined}
                    aria-labelledby={useResponsiveTabs ? 'notebook-sources-tab' : undefined}
                    hidden={useResponsiveTabs && mobileTab !== 'sources'}
                >
                    <div className="notebook-panel-heading"><div><h2>{t('notebooks.sources_tab', 'Sources')}</h2><span>{t('notebooks.resources_sources_summary', '{{resources}} Resources · {{sources}} sources', { resources: notebook.resource_count, sources: notebook.source_counts?.total || 0 })}</span></div>{notebook.can_manage && <button className="notebook-icon-button" onClick={() => setShowAdd(true)} aria-label={t('notebooks.add_resources', 'Add Resources')}><Plus size={17} /></button>}</div>
                    <div className="notebook-source-list">
                        {(sources.items || []).map((resource) => (
                            <article key={resource.resource_id} className="notebook-source-card">
                                <div className="notebook-source-card__header">
                                    <div><strong>{resource.title || resource.resource_id}</strong><StatusBadge status={resource.state} /></div>
                                    {notebook.can_manage && (
                                        <div className="notebook-source-card__actions">
                                            {['error', 'stale'].includes(resource.state) && <button className="notebook-icon-button notebook-icon-button--small" disabled={retryingId === resource.resource_id || ACTIVE_STATES.has(notebook.progress?.state)} onClick={() => retryResource(resource.resource_id)} aria-label={t('notebooks.retry_resource', 'Retry Resource')}><RefreshCw size={13} className={retryingId === resource.resource_id ? 'animate-spin' : ''} /></button>}
                                            <button className="notebook-icon-button notebook-icon-button--small" disabled={removingId === resource.resource_id} onClick={() => remove(resource.resource_id)} aria-label={t('notebooks.remove_resource', 'Remove Resource')}><X size={14} /></button>
                                        </div>
                                    )}
                                </div>
                                {resource.error && <p className="notebook-source-error">{resource.error}</p>}
                                {resource.last_checked_at && <p className="notebook-source-checked">{t('notebooks.last_checked', 'Last checked: {{time}}', { time: new Date(resource.last_checked_at).toLocaleString() })}</p>}
                                <ul>{(resource.sources || []).map((source) => <li key={source.source_id}><div className="notebook-source-card__source"><span>{source.kind === 'url' ? <Globe2 size={13} /> : <BookOpen size={13} />}{source.label}</span>{source.error && <small>{source.error}</small>}</div><StatusBadge status={source.status} /></li>)}</ul>
                            </article>
                        ))}
                    </div>
                    {sourcePageCount > 1 && (
                        <nav className="notebook-pagination notebook-pagination--panel" aria-label={t('notebooks.source_pagination', 'Source pages')}>
                            <button disabled={sources.page <= 1} onClick={() => load({ refresh: false, page: sources.page - 1 })}><ChevronLeft size={15} /></button>
                            <span>{t('notebooks.page_of', 'Page {{page}} of {{pages}}', { page: sources.page, pages: sourcePageCount })}</span>
                            <button disabled={sources.page >= sourcePageCount} onClick={() => load({ refresh: false, page: sources.page + 1 })}><ChevronRight size={15} /></button>
                        </nav>
                    )}
                </aside>

                <section
                    id="notebook-chat-panel"
                    className={`notebook-chat-panel notebook-mobile-tabpanel ${mobileTab === 'chat' ? 'is-mobile-active' : ''}`}
                    role={useResponsiveTabs ? 'tabpanel' : undefined}
                    aria-labelledby={useResponsiveTabs ? 'notebook-chat-tab' : undefined}
                    hidden={useResponsiveTabs && mobileTab !== 'chat'}
                >
                    {notebook.chat_ready ? (
                        <AgentChat
                            key={`${notebook.conversation_session_id}:${chatEpoch}`}
                            embedded
                            storageIdentity={localStorage.getItem('gnosi_user_id') || 'personal'}
                            forcedSessionId={notebook.conversation_session_id}
                            forcedAgentId="gnosy"
                            notebookId={notebook.id}
                            conversationMode={notebook.conversation_mode}
                            contextRefs={chatContext}
                            readOnly={!notebook.can_chat}
                        />
                    ) : <div className="notebook-chat-blocked"><LoaderCircle size={26} className={notebook.status !== 'error' ? 'animate-spin' : ''} /><h2>{t('notebooks.chat_preparing_title', 'Preparing the first sources')}</h2><p>{t('notebooks.chat_preparing_description', 'Conversation becomes available when at least one source has been indexed.')}</p></div>}
                </section>

                <aside
                    id="notebook-settings-panel"
                    className={`notebook-settings-panel notebook-mobile-tabpanel ${mobileTab === 'settings' ? 'is-mobile-active' : ''}`}
                    role={useResponsiveTabs ? 'tabpanel' : undefined}
                    aria-labelledby={useResponsiveTabs ? 'notebook-settings-tab' : undefined}
                    hidden={useResponsiveTabs && mobileTab !== 'settings'}
                >
                    <div className="notebook-panel-heading"><div><h2>{t('notebooks.settings_tab', 'Settings')}</h2><span>{t('notebooks.settings_help', 'Access and conversation behavior')}</span></div></div>
                    <label className="notebook-field"><span>{t('notebooks.visibility_label', 'Visibility')}</span><select value={notebook.visibility} disabled={!notebook.can_manage} onChange={(event) => patchNotebook({ visibility: event.target.value })}><option value="private">{t('notebooks.visibility_private', 'Private')}</option><option value="workspace">{t('notebooks.visibility_workspace', 'Workspace')}</option></select></label>
                    <label className="notebook-field"><span>{t('notebooks.conversation_label', 'Conversation')}</span><select value={notebook.conversation_mode} disabled={!notebook.can_manage} onChange={(event) => patchNotebook({ conversation_mode: event.target.value })}><option value="private_member">{t('notebooks.conversation_private', 'Private per member')}</option><option value="shared">{t('notebooks.conversation_shared', 'Shared')}</option></select></label>
                    <p className="notebook-settings-note">{notebook.conversation_mode === 'shared' ? t('notebooks.shared_history_note', 'Shared history is append-only and visible to authorized members.') : t('notebooks.private_history_note', 'Each member has an isolated history. Switching modes does not merge conversations.')}</p>
                    {(notebook.conversation_mode !== 'shared' ? notebook.can_chat : notebook.can_manage) && (
                        <button className="notebook-clear-conversation" type="button" onClick={() => setShowClear(true)}>
                            <Trash2 size={14} />{t('notebooks.clear_conversation', 'Clear conversation')}
                        </button>
                    )}
                </aside>
            </div>
            {showAdd && <AddResourcesDialog notebookId={notebook.id} currentIds={currentIds} onClose={() => setShowAdd(false)} onAdded={() => load({ refresh: false })} />}
            <ConfirmModal isOpen={showDelete} onClose={() => setShowDelete(false)} onConfirm={deleteNotebook} title={t('notebooks.delete_title', 'Delete notebook?')} message={t('notebooks.delete_message', 'Indexes and notebook conversations will be deleted. Original Resources, attachments, and URLs will not be changed.')} confirmText={t('notebooks.delete', 'Delete notebook')} cancelText={t('common.cancel', 'Cancel')} isDestructive />
            <ConfirmModal isOpen={showClear} onClose={() => setShowClear(false)} onConfirm={clearConversation} title={t('notebooks.clear_conversation_title', 'Clear this conversation?')} message={t('notebooks.clear_conversation_message', 'This removes the active conversation history. It does not change sources or other conversation modes.')} confirmText={t('notebooks.clear_conversation', 'Clear conversation')} cancelText={t('common.cancel', 'Cancel')} isDestructive />
        </div>
    );
}

export default function NotebooksPage() {
    const { notebookId } = useParams();
    const navigate = useNavigate();
    const [createOpen, setCreateOpen] = useState(false);
    return (
        <>
            {notebookId ? <NotebookDetail notebookId={notebookId} /> : <NotebookLibrary onCreate={() => setCreateOpen(true)} />}
            <NotebookCreateDialog isOpen={createOpen} onClose={() => setCreateOpen(false)} onCreated={(notebook) => navigate(`/notebooks/${notebook.id}`)} />
        </>
    );
}
