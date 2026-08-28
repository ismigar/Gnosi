import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Check, ChevronLeft, ChevronRight, Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from '../../lib/toast';
import { useModalKeyboard } from '../../hooks/useModalKeyboard';
import NotebookResourceFilters from './NotebookResourceFilters';
import {
    EMPTY_RESOURCE_FACETS,
    EMPTY_RESOURCE_FILTERS,
    normalizeResourceFacets,
    notebookResourceCatalogUrl,
} from './notebookResourceCatalog';
import { transportFetch } from '../../shared/api/transports';

const EMPTY_RESOURCE_IDS = Object.freeze([]);

export default function NotebookCreateDialog({
    isOpen,
    initialResourceIds = EMPTY_RESOURCE_IDS,
    onClose,
    onCreated,
}) {
    const { t } = useTranslation();
    const [title, setTitle] = useState('');
    const [visibility, setVisibility] = useState('private');
    const [conversationMode, setConversationMode] = useState('private_member');
    const [selectedIds, setSelectedIds] = useState(new Set());
    const [resourceData, setResourceData] = useState({ items: [], total: 0, page: 1, page_size: 50, facets: EMPTY_RESOURCE_FACETS, hidden_without_sources: 0 });
    const [query, setQuery] = useState('');
    const [filters, setFilters] = useState({ ...EMPTY_RESOURCE_FILTERS });
    const [loadingResources, setLoadingResources] = useState(false);
    const [creating, setCreating] = useState(false);
    const dialogRef = useRef(null);
    const initialKey = useMemo(
        () => [...initialResourceIds].map(String).sort().join(':'),
        [initialResourceIds],
    );

    useModalKeyboard({
        isOpen,
        onClose,
        closeOnEscape: !creating,
        containerRef: dialogRef,
        trapFocus: true,
    });

    useEffect(() => {
        if (!isOpen) return;
        setTitle(t('notebooks.default_title', 'New notebook'));
        setVisibility('private');
        setConversationMode('private_member');
        setSelectedIds(new Set(initialResourceIds.map(String)));
        setQuery('');
        setFilters({ ...EMPTY_RESOURCE_FILTERS });
        setResourceData((previous) => ({ ...previous, page: 1 }));
    }, [initialKey, initialResourceIds, isOpen, t]);

    useEffect(() => {
        if (!isOpen) return;
        const controller = new AbortController();
        const timer = window.setTimeout(() => {
            setLoadingResources(true);
            transportFetch(notebookResourceCatalogUrl({
                query,
                page: resourceData.page,
                filters,
            }), {
                signal: controller.signal,
            })
                .then((response) => response.ok ? response.json() : Promise.reject(new Error(`Resource list failed (${response.status})`)))
                .then((data) => setResourceData({
                    items: Array.isArray(data.items) ? data.items : [],
                    total: Number(data.total) || 0,
                    page: Number(data.page) || resourceData.page,
                    page_size: Number(data.page_size) || 50,
                    facets: normalizeResourceFacets(data.facets),
                    hidden_without_sources: Number(data.hidden_without_sources) || 0,
                }))
                .catch((error) => {
                    if (error.name !== 'AbortError') {
                        console.error('Could not load notebook Resources', error);
                        toast.error(t('notebooks.resources_error', 'Resources could not be loaded.'));
                    }
                })
                .finally(() => setLoadingResources(false));
        }, 180);
        return () => {
            window.clearTimeout(timer);
            controller.abort();
        };
    }, [filters, isOpen, query, resourceData.page, t]);

    if (!isOpen) return null;

    const resourcePageCount = Math.max(1, Math.ceil(resourceData.total / resourceData.page_size));

    const toggleResource = (resourceId) => {
        setSelectedIds((previous) => {
            const next = new Set(previous);
            if (next.has(resourceId)) next.delete(resourceId);
            else next.add(resourceId);
            return next;
        });
    };

    const updateFilter = (key, value) => {
        setFilters((previous) => key ? { ...previous, [key]: value } : { ...EMPTY_RESOURCE_FILTERS });
        setResourceData((previous) => ({ ...previous, page: 1 }));
    };

    const create = async (event) => {
        event.preventDefault();
        if (!selectedIds.size || creating) return;
        setCreating(true);
        try {
            const response = await transportFetch('/api/notebooks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: title.trim() || t('notebooks.default_title', 'New notebook'),
                    visibility,
                    conversation_mode: conversationMode,
                    resource_ids: [...selectedIds],
                }),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.detail || `Notebook creation failed (${response.status})`);
            toast.success(t('notebooks.created', 'Notebook created.'));
            onCreated?.(data);
            onClose?.();
        } catch (error) {
            console.error('Could not create notebook', error);
            toast.error(t('notebooks.create_error', 'The notebook could not be created: {{message}}', { message: error.message }));
        } finally {
            setCreating(false);
        }
    };

    return (
        <div className="notebook-modal-backdrop" role="presentation">
            <form ref={dialogRef} className="notebook-modal" role="dialog" aria-modal="true" aria-labelledby="notebook-create-title" onSubmit={create}>
                <header className="notebook-modal__header">
                    <div className="notebook-modal__title-wrap">
                        <span className="notebook-icon"><BookOpen size={18} /></span>
                        <div>
                            <h2 id="notebook-create-title">{t('notebooks.create_title', 'Create a notebook')}</h2>
                            <p>{t('notebooks.create_subtitle', 'Only attachment and URL fields become sources.')}</p>
                        </div>
                    </div>
                    <button type="button" className="notebook-icon-button" onClick={onClose} disabled={creating} aria-label={t('common.close', 'Close')}>
                        <X size={18} />
                    </button>
                </header>

                <div className="notebook-modal__body">
                    <label className="notebook-field">
                        <span>{t('notebooks.title_label', 'Title')}</span>
                        <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} data-autofocus />
                    </label>

                    <div className="notebook-modal__options">
                        <label className="notebook-field">
                            <span>{t('notebooks.visibility_label', 'Visibility')}</span>
                            <select value={visibility} onChange={(event) => setVisibility(event.target.value)}>
                                <option value="private">{t('notebooks.visibility_private', 'Private')}</option>
                                <option value="workspace">{t('notebooks.visibility_workspace', 'Workspace')}</option>
                            </select>
                        </label>
                        <label className="notebook-field">
                            <span>{t('notebooks.conversation_label', 'Conversation')}</span>
                            <select value={conversationMode} onChange={(event) => setConversationMode(event.target.value)}>
                                <option value="private_member">{t('notebooks.conversation_private', 'Private per member')}</option>
                                <option value="shared">{t('notebooks.conversation_shared', 'Shared')}</option>
                            </select>
                        </label>
                    </div>

                    <section className="notebook-resource-picker" aria-label={t('notebooks.resources', 'Resources')}>
                        <div className="notebook-resource-picker__header">
                            <strong>{t('notebooks.selected_resources', '{{count}} Resources selected', { count: selectedIds.size })}</strong>
                            <label className="notebook-search">
                                <Search size={15} />
                                <input value={query} onChange={(event) => {
                                    setQuery(event.target.value);
                                    setResourceData((previous) => ({ ...previous, page: 1 }));
                                }} placeholder={t('notebooks.search_resources', 'Search Resources...')} />
                            </label>
                        </div>
                        <NotebookResourceFilters
                            facets={resourceData.facets}
                            filters={filters}
                            onChange={updateFilter}
                            disabled={loadingResources}
                        />
                        {resourceData.hidden_without_sources > 0 && (
                            <p className="notebook-resource-picker__notice" role="status">
                                {t(
                                    'notebooks.resources_without_sources_hidden',
                                    '{{count}} Resources are not shown because they have no attachments or URLs.',
                                    { count: resourceData.hidden_without_sources },
                                )}
                            </p>
                        )}
                        <div className="notebook-resource-picker__list">
                            {loadingResources && <div className="notebook-empty">{t('common.loading', 'Loading...')}</div>}
                            {!loadingResources && resourceData.items.map((resource) => {
                                const checked = selectedIds.has(String(resource.id));
                                return (
                                    <button key={resource.id} type="button" aria-pressed={checked} className={`notebook-resource-row ${checked ? 'is-selected' : ''}`} onClick={() => toggleResource(String(resource.id))}>
                                        <span className="notebook-resource-row__check">{checked && <Check size={13} />}</span>
                                        <span className="notebook-resource-row__text">
                                            <strong>{resource.title}</strong>
                                            <small>{t('notebooks.source_count', '{{count}} source(s)', { count: resource.source_count })}</small>
                                        </span>
                                    </button>
                                );
                            })}
                            {!loadingResources && !resourceData.items.length && <div className="notebook-empty">{t('notebooks.no_resources', 'No Resources found.')}</div>}
                        </div>
                        {resourcePageCount > 1 && (
                            <nav className="notebook-pagination notebook-pagination--compact" aria-label={t('notebooks.resource_pagination', 'Resource pages')}>
                                <button type="button" aria-label={t('common.previous', 'Previous')} disabled={resourceData.page <= 1} onClick={() => setResourceData((previous) => ({ ...previous, page: previous.page - 1 }))}><ChevronLeft size={15} /></button>
                                <span>{t('notebooks.page_of', 'Page {{page}} of {{pages}}', { page: resourceData.page, pages: resourcePageCount })}</span>
                                <button type="button" aria-label={t('common.next', 'Next')} disabled={resourceData.page >= resourcePageCount} onClick={() => setResourceData((previous) => ({ ...previous, page: previous.page + 1 }))}><ChevronRight size={15} /></button>
                            </nav>
                        )}
                    </section>
                </div>

                <footer className="notebook-modal__footer">
                    <button type="button" className="btn-gnosi" onClick={onClose} disabled={creating}>{t('common.cancel', 'Cancel')}</button>
                    <button type="submit" className="btn-gnosi btn-gnosi-primary" disabled={!selectedIds.size || creating}>
                        {creating ? t('notebooks.creating', 'Creating...') : t('notebooks.create_action', 'Create notebook')}
                    </button>
                </footer>
            </form>
        </div>
    );
}
