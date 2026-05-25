import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import { toast } from '../lib/toast';
import { v4 as uuidv4 } from 'uuid';
import { logError, notifyError } from '../lib/notifyError';
import { FileText, Loader2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { VaultShell } from '../components/Vault/VaultShell';
import { VaultSidebar } from '../components/Vault/VaultSidebar';
import { VaultTabs } from '../components/Vault/VaultTabs';
import { VaultTable } from '../components/Vault/VaultTable';
import { VaultKanban } from '../components/Vault/VaultKanban';
import { BlockEditor } from '../components/Vault/BlockEditor';
import { inFlightSaves } from '../components/Vault/editorState';
import { SchemaConfigModal } from '../components/Vault/SchemaConfigModal';
import { ViewConfigModal } from '../components/Vault/ViewConfigModal';
import { GlobalSearchModal } from '../components/Vault/GlobalSearchModal';
import { RecentModal } from '../components/Vault/RecentModal';
import { DigitalBrainCalendar } from '../components/Vault/DigitalBrainCalendar';
import { VaultGallery } from '../components/Vault/VaultGallery';
import { VaultTimeline } from '../components/Vault/VaultTimeline';
import { VaultFeed } from '../components/Vault/VaultFeed';
import { VaultDocumentTabs } from '../components/Vault/VaultDocumentTabs';
import { ZoteroReaderTab } from '../components/Vault/ZoteroReaderTab';
import { VaultViewsHeader } from '../components/Vault/VaultViewsHeader';
import VaultDrawings from '../components/Vault/VaultDrawings';
import { VaultGraph } from '../components/Vault/VaultGraph';
import { VaultTrashView } from '../components/Vault/VaultTrashView';
import { MAIN_VIEW_NAME, isMainView } from '../components/Vault/viewConstants';
import { buildSchemaFromTableProperties, buildTablePropertiesFromSchema, getSchemaFieldNames, isCalendarPage } from '../components/Vault/schemaUtils';
import { applyDefaultFormulasToMetadata } from '../components/Vault/defaultFormulaUtils';
import { Palette } from 'lucide-react';
import ConfirmModal from '../components/ConfirmModal';
import TldrawEditor from '../components/Vault/TldrawEditor';

export default function VaultDashboard() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const { "*": nestedPath } = useParams();

    const [pages, setPages] = useState([]);
    const pagesRef = useRef([]);
    const viewCreationInProgressRef = useRef(new Set());
    const [tabs, setTabs] = useState([]);
    const [activeTabId, setActiveTabId] = useState(null);
    const [codeViewByTabId, setCodeViewByTabId] = useState({});
    // Bloqueig d'edició per pàgina (per ID). Persistit a localStorage perquè
    // el lock sobrevisqui reload del navegador. Quan està tancat (true), el
    // BlockEditor renderitza com a read-only i bloqueja totes les
    // modificacions (text, propietats, drag-drop, slash menu).
    const [editLockedByPageId, setEditLockedByPageId] = useState(() => {
        try {
            const raw = localStorage.getItem('gnosi.vault.editLockedPages');
            if (raw) return JSON.parse(raw);
        } catch { /* noop */ }
        return {};
    });
    useEffect(() => {
        try {
            localStorage.setItem('gnosi.vault.editLockedPages', JSON.stringify(editLockedByPageId));
        } catch { /* noop */ }
    }, [editLockedByPageId]);
    const [splitTabIds, setSplitTabIds] = useState([]);
    const [splitTableIds, setSplitTableIds] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isRegistryLoading, setIsRegistryLoading] = useState(true);
    const [viewToDelete, setViewToDelete] = useState(null);
    const [promptModal, setPromptModal] = useState({ isOpen: false, defaultTitle: '', parentId: null, isDatabase: false, isDrawing: false, isDashboard: false, isView: false, isRename: false, targetView: null, viewType: null, inputValue: '', isLoading: false });

    // For now we support "editor" for all pages.
    // You can add "table" directly here or via custom blocks.
    const [viewMode, setViewMode] = useState('editor');

    // No more currentFolder, everything is just ID contexts
    const [schema, setSchema] = useState({});
    const [views, setViews] = useState([]);
    const [activeViewId, setActiveViewId] = useState(null);
    const [isGlobalSearchOpen, setIsGlobalSearchOpen] = useState(false);
    const [isRecentOpen, setIsRecentOpen] = useState(false);
    const [historyOpenSignal, setHistoryOpenSignal] = useState(0);
    const [globalIndex, setGlobalIndex] = useState({});
    const [registry, setRegistry] = useState({ databases: [], tables: [], views: [] });
    const [activeTableId, setActiveTableId] = useState(null);
    const [tableNotes, setTableNotes] = useState([]);
    const [tableTemplates, setTableTemplates] = useState([]);
    const [visibleTableRecordsById, setVisibleTableRecordsById] = useState({});
    const [_tableCountsById, setTableCountsById] = useState({});
    const [isSchemaModalOpen, setIsSchemaModalOpen] = useState(false);
    const [isViewConfigOpen, setIsViewConfigOpen] = useState(false);
    const [viewToConfigure, setViewToConfigure] = useState(null);
    const [viewConfigTab, setViewConfigTab] = useState('appearance');
    const [pendingView, setPendingView] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const pageRequestInFlightRef = useRef(new Map());
    // AbortController for the *currently active* page navigation. When the
    // user clicks pages quickly, we abort the previous in-flight loadPage so
    // late responses can't overwrite state with stale data (race condition).
    const activeLoadAbortRef = useRef(null);
    // Per-pageId AbortController map for fetchPageById, so the in-flight
    // request can be cancelled when a newer load supersedes it.
    const pageRequestAbortersRef = useRef(new Map());


    // --- Personal Navigation History ---
    const [navigationHistory, setNavigationHistory] = useState([]);
    const [historyPointer, setHistoryPointer] = useState(-1);
    const [isInternalNavigating, setIsInternalNavigating] = useState(false);

    // --- Action History (Undo/Redo) ---
    const [undoStack, setUndoStack] = useState([]);
    const [redoStack, setRedoStack] = useState([]);
    const undoRef = useRef(null);
    const redoRef = useRef(null);
    const TABLE_TAB_PREFIX = 'table:';
    // Prefix estable per identificar una pestanya PDF/EPUB/snapshot. Reusa
    // la pestanya quan l'usuari clica el mateix document dues vegades.
    const PDF_TAB_PREFIX = 'pdf:';

    const isAbortLikeError = useCallback((err) => {
        if (!err) return false;
        if (axios.isCancel?.(err)) return true;

        const code = String(err.code || '').toUpperCase();
        const name = String(err.name || '').toLowerCase();
        const message = String(err.message || '').toLowerCase();

        return (
            code === 'ERR_CANCELED'
            || name === 'cancelederror'
            || message.includes('aborted')
            || message.includes('canceled')
            || message.includes('cancelled')
        );
    }, []);

    const fetchPageById = useCallback(async (pageId, maxAbortRetries = 1, externalSignal = null) => {
        if (!pageId) return null;

        const existingRequest = pageRequestInFlightRef.current.get(pageId);
        if (existingRequest) {
            return existingRequest;
        }

        // Per-pageId controller so that an external signal from the caller can
        // abort the underlying axios call (e.g. when the user navigates away).
        const controller = new AbortController();
        pageRequestAbortersRef.current.set(pageId, controller);

        const onExternalAbort = () => controller.abort();
        if (externalSignal) {
            if (externalSignal.aborted) {
                controller.abort();
            } else {
                externalSignal.addEventListener('abort', onExternalAbort, { once: true });
            }
        }

        const requestPromise = (async () => {
            let lastErr = null;
            for (let attempt = 0; attempt <= maxAbortRetries; attempt += 1) {
                try {
                    const res = await axios.get(`/api/vault/pages/${pageId}`, { signal: controller.signal });
                    return res;
                } catch (err) {
                    lastErr = err;
                    // If the external caller aborted, propagate immediately.
                    if (externalSignal?.aborted) throw err;
                    if (isAbortLikeError(err) && attempt < maxAbortRetries) {
                        await new Promise(resolve => setTimeout(resolve, 60));
                        continue;
                    }
                    throw err;
                }
            }

            throw lastErr;
        })();

        pageRequestInFlightRef.current.set(pageId, requestPromise);

        try {
            // Check if there is an in-flight save for this page.
            // If so, we want to return a mock response with the in-flight content
            // to prevent the user from seeing stale data while the save is still processing.
            const inFlight = inFlightSaves.get(pageId);
            if (inFlight) {
                return {
                    data: {
                        id: pageId,
                        title: inFlight.metadata?.title || t('common.untitled'),
                        content: inFlight.content,
                        metadata: inFlight.metadata,
                        last_modified: new Date(inFlight.timestamp).toISOString()
                    }
                };
            }

            return await requestPromise;
        } finally {
            pageRequestInFlightRef.current.delete(pageId);
            pageRequestAbortersRef.current.delete(pageId);
            if (externalSignal) {
                externalSignal.removeEventListener?.('abort', onExternalAbort);
            }
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isAbortLikeError]);


    const buildTableTabId = (tableId) => `${TABLE_TAB_PREFIX}${tableId}`;

    const getTableIdFromTab = (tab) => {
        if (!tab?.isTable) return null;
        if (tab.tableId) return tab.tableId;
        if (typeof tab.id === 'string' && tab.id.startsWith(TABLE_TAB_PREFIX)) {
            return tab.id.slice(TABLE_TAB_PREFIX.length);
        }
        return tab.id;
    };

    const pushToHistory = useCallback((entry) => {
        if (isInternalNavigating) return;

        // React Router Navigation (URL Synchronization)
        if (entry.type === 'table') {
            const url = entry.subId ? `/vault/table/${entry.id}/view/${entry.subId}` : `/vault/table/${entry.id}`;
            navigate(url);
        } else if (entry.type === 'editor') {
            navigate(`/vault/page/${entry.id}`);
        } else if (entry.type === 'drawing') {
            navigate('/vault/drawing');
        }

        setNavigationHistory(prev => {
            const next = prev.slice(0, historyPointer + 1);
            // Avoid consecutive duplicates of the same ID and type
            if (next.length > 0 && next[next.length - 1].id === entry.id && next[next.length - 1].type === entry.type && next[next.length - 1].subId === entry.subId) {
                return next;
            }
            // Desa l'origen (la ubicació que deixem) perquè el breadcrumb pugui
            // tornar al lloc real d'on s'ha obert l'entrada (p.ex. un dashboard),
            // no només a la taula a què pertany estructuralment el registre.
            const prevTop = next.length > 0 ? next[next.length - 1] : null;
            const from = prevTop ? { type: prevTop.type, id: prevTop.id, subId: prevTop.subId } : null;
            return [...next, { ...entry, from }];
        });
        setHistoryPointer(prev => prev + 1);
    }, [historyPointer, isInternalNavigating, navigate]);

    const getSchemaFromTableId = useCallback((tableId) => {
        if (!tableId) return {};
        const table = registry.tables?.find(t => t.id === tableId);
        if (!table || !table.properties) return {};
        return buildSchemaFromTableProperties(table.properties);
    }, [registry.tables]);

    const closePromptModal = useCallback(() => {
        setPromptModal({ 
            isOpen: false, 
            defaultTitle: '', 
            parentId: null, 
            isDatabase: false, 
            isDrawing: false, 
            isDashboard: false,
            isView: false, 
            isRename: false, 
            targetView: null, 
            viewType: null, 
            inputValue: '', 
            isLoading: false 
        });
    }, []);

    const resolvePageTableId = useCallback((page, currentPages = pages) => {
        if (!page) return null;
        const directId = page.resolved_table_id || page.metadata?.table_id || page.metadata?.database_table_id;
        if (String(directId || '').toLowerCase() === 'wiki') return null;
        if (directId) return directId;
        
        // Recursive recursive search upwards for table context (for subfolders in BD/)
        if (page.parent_id && currentPages?.length > 0) {
            const parent = currentPages.find(p => p.id === page.parent_id);
            if (parent && parent.id !== page.id) return resolvePageTableId(parent, currentPages);
        }
        
        return null;
    }, [pages]);


    const shouldIncludeTableRecord = useCallback((page, tableId, currentPages = pages) => {
        if (!page || resolvePageTableId(page, currentPages) !== tableId) return false;
        if (page.metadata?.is_template) return false;

        // Wiki (null tableId) should not include calendar entries
        if (!tableId && isCalendarPage(page)) return false;

        // Resources also contains technical/imported annotations that are not primary records.
        if (tableId === 'resources') {
            const tipus = String(page.metadata?.Tipus || '').trim().toLowerCase();
            const title = String(page.title || '').trim().toLowerCase();
            const gnosiId = String(page.metadata?.id || page.id || '').trim();
            if (tipus === 'annotation') return false;
            if (title === 'nou' || title === 'sense títol' || title === 'sense titol') return false;
            if (!gnosiId) return false;
        }

        return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [resolvePageTableId, pages, isCalendarPage]);

    const getVisibleTableRecords = useCallback((records, tableId, currentPages = pages) => {
        const filtered = (records || []).filter(page => shouldIncludeTableRecord(page, tableId, currentPages));
        if (tableId !== 'resources') return filtered;


        // Some resources arrive duplicated with punctuation/accent variations in the title.
        const normalizeTitle = (value) => String(value || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, ' ')
            .trim();

        const deduped = new Map();
        filtered.forEach((page) => {
            const key = normalizeTitle(page.title);
            if (!key) {
                deduped.set(`__${page.id}`, page);
                return;
            }

            const existing = deduped.get(key);
            if (!existing) {
                deduped.set(key, page);
                return;
            }

            const existingTs = new Date(existing.last_modified || 0).getTime();
            const nextTs = new Date(page.last_modified || 0).getTime();
            if (nextTs > existingTs) {
                deduped.set(key, page);
            }
        });

        return Array.from(deduped.values());
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [shouldIncludeTableRecord]);

    const getTableVisibleRecords = useCallback((tableId) => {
        if (!tableId) return [];
        return visibleTableRecordsById[tableId] || getVisibleTableRecords(pages, tableId);
    }, [getVisibleTableRecords, pages, visibleTableRecordsById]);

    const syncPagesState = useCallback((nextPages) => {
        // Defensive deduplication to prevent React key collisions if backend serves duplicates
        const uniquePagesMap = new Map();
        (nextPages || []).forEach(p => {
            if (!p.id) return;
            const existing = uniquePagesMap.get(p.id);
            if (!existing || p.last_modified > existing.last_modified) {
                uniquePagesMap.set(p.id, p);
            }
        });
        const dedupedPages = Array.from(uniquePagesMap.values());
        pagesRef.current = dedupedPages;
        setPages(dedupedPages);

        if (activeTableId) {
            const matchesActiveTable = (page) => resolvePageTableId(page, dedupedPages) === activeTableId;
            const cachedVisible = visibleTableRecordsById[activeTableId];
            setTableNotes(cachedVisible || getVisibleTableRecords(dedupedPages, activeTableId, dedupedPages));
            setTableTemplates(dedupedPages.filter(page => matchesActiveTable(page) && page.metadata?.is_template));
        }

        setGlobalIndex(prev => ({
            ...prev,
            ...Object.fromEntries(dedupedPages.map(page => [page.id, page.title || t('common.untitled')]))
        }));
    }, [activeTableId, getVisibleTableRecords, resolvePageTableId, visibleTableRecordsById, t]);

    // Optimistic patch del sidebar: el BlockEditor el crida abans (o en
    // paral·lel) al PATCH del backend per a canvis discrets com icona o
    // portada, perquè el sidebar es refresqui de seguida sense esperar al
    // re-fetch complet de pàgines.
    const updatePageMetadataLocal = useCallback((pageId, partialMetadata) => {
        if (!pageId || !partialMetadata) return;
        setPages(prev => {
            const next = prev.map(p => {
                if (p.id !== pageId) return p;
                return { ...p, metadata: { ...(p.metadata || {}), ...partialMetadata } };
            });
            pagesRef.current = next;
            return next;
        });
    }, []);

    const applySchemaDefaults = useCallback((tableId, metadata = {}, title = 'Nou') => {
        if (!tableId) return metadata;
        const tableSchema = getSchemaFromTableId(tableId);
        return applyDefaultFormulasToMetadata({
            schema: tableSchema,
            metadata,
            title,
            notes: pages,
            currentTableId: tableId,
        });
    }, [getSchemaFromTableId, pages]);

    const handleNavigationBack = () => {
        if (historyPointer > 0) {
            const prevEntry = navigationHistory[historyPointer - 1];
            setIsInternalNavigating(true);
            setHistoryPointer(prev => prev - 1);

            if (prevEntry.type === 'editor') {
                loadPage(prevEntry.id, true);
            } else if (prevEntry.type === 'table') {
                handleTableSelect(prevEntry.id, null, true);
            }

            setTimeout(() => setIsInternalNavigating(false), 100);
        }
    };

    const handleNavigationForward = () => {
        if (historyPointer < navigationHistory.length - 1) {
            const nextEntry = navigationHistory[historyPointer + 1];
            setIsInternalNavigating(true);
            setHistoryPointer(prev => prev + 1);

            if (nextEntry.type === 'editor') {
                loadPage(nextEntry.id, true);
            } else if (nextEntry.type === 'table') {
                handleTableSelect(nextEntry.id, null, true);
            }

            setTimeout(() => setIsInternalNavigating(false), 100);
        }
    };
    // --------------------------------------------

    // Track in-flight retry timers so we can cancel them on unmount —
    // otherwise `setTimeout(() => fetchPages(...))` keeps firing after the
    // component is gone and triggers React "setState on unmounted" warnings.
    const fetchPagesRetryTimerRef = useRef(null);
    useEffect(() => {
        return () => {
            if (fetchPagesRetryTimerRef.current) {
                clearTimeout(fetchPagesRetryTimerRef.current);
                fetchPagesRetryTimerRef.current = null;
            }
        };
    }, []);

    const FETCH_PAGES_MAX_ATTEMPTS = 8;

    const fetchPages = useCallback(async (attempt = 0) => {
        try {
            setLoading(true);
            const res = await axios.get('/api/vault/pages');
            if (res.data.length === 0 && attempt < FETCH_PAGES_MAX_ATTEMPTS) {
                // Backend cache may still be warming up — retry with backoff
                if (fetchPagesRetryTimerRef.current) clearTimeout(fetchPagesRetryTimerRef.current);
                fetchPagesRetryTimerRef.current = setTimeout(
                    () => fetchPages(attempt + 1),
                    Math.min(1000 * (attempt + 1), 5000),
                );
                return [];
            }
            syncPagesState(res.data);
            setLoading(false);
            return res.data;
        } catch (err) {
            if (isAbortLikeError(err) && attempt < 2) {
                if (fetchPagesRetryTimerRef.current) clearTimeout(fetchPagesRetryTimerRef.current);
                fetchPagesRetryTimerRef.current = setTimeout(
                    () => fetchPages(attempt + 1),
                    400 * (attempt + 1),
                );
                return [];
            }
            // 503 amb Retry-After: el backend ens diu que l'índex encara s'està
            // escalfant. Reintentem respectant la capçalera (fallback 2s).
            if (err?.response?.status === 503 && attempt < FETCH_PAGES_MAX_ATTEMPTS) {
                const retryAfter = Number(err.response.headers?.['retry-after']) || 2;
                if (fetchPagesRetryTimerRef.current) clearTimeout(fetchPagesRetryTimerRef.current);
                fetchPagesRetryTimerRef.current = setTimeout(
                    () => fetchPages(attempt + 1),
                    Math.min(retryAfter * 1000, 5000),
                );
                return [];
            }
            notifyError('load-pages', err, t('errors.load_pages'));
            setLoading(false);
            return [];
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [syncPagesState, isAbortLikeError]);

    const fetchRegistry = useCallback(async (attempt = 0) => {
        if (attempt === 0) {
            setIsRegistryLoading(true);
        }
        try {
            const res = await axios.get('/api/vault/registry');
            setRegistry(res.data);
            setIsRegistryLoading(false);
        } catch (err) {
            // Log every retry attempt; only toast on the final failure to avoid
            // a chain of "load failed" toasts during transient warm-up errors.
            logError('load-registry', err);
            if (attempt < 2) {
                setTimeout(() => fetchRegistry(attempt + 1), 800);
                return;
            }
            notifyError('load-registry', err, t('errors.load_registry'));
            setIsRegistryLoading(false);
            toast.error(t('errors.connection'));
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const fetchPagesByTable = useCallback(async (tableId) => {
        if (!tableId) return [];
        try {
            const res = await axios.get(`/api/vault/pages/by-table/${tableId}`);
            const tablePages = res.data || [];
            const templates = tablePages.filter(p => p.metadata?.is_template);
            setTableTemplates(templates);

            setPages(prevPages => {
                const nonTablePages = prevPages.filter(p => resolvePageTableId(p) !== tableId);
                const merged = [...nonTablePages, ...tablePages];
                setGlobalIndex(prev => ({
                    ...prev,
                    ...Object.fromEntries(merged.map(page => [page.id, page.title || t('common.untitled')]))
                }));
                return merged;
            });

            fetchGlobalIndex();

            try {
                const snapshotRes = await axios.get(`/api/vault/pages/by-table/${tableId}/snapshot`);
                const snapshot = snapshotRes.data || {};
                const visiblePages = snapshot.pages || [];
                setVisibleTableRecordsById(prev => ({ ...prev, [tableId]: visiblePages }));
                setTableCountsById(prev => ({
                    ...prev,
                    [tableId]: {
                        raw: Number(snapshot.raw_count || tablePages.length),
                        visible: Number(snapshot.visible_count || visiblePages.length),
                    }
                }));
            } catch (snapshotErr) {
                const fallbackVisible = tablePages.filter(page => shouldIncludeTableRecord(page, tableId, tablePages));
                setVisibleTableRecordsById(prev => ({ ...prev, [tableId]: fallbackVisible }));
                setTableCountsById(prev => ({
                    ...prev,
                    [tableId]: { raw: tablePages.length, visible: fallbackVisible.length }
                }));
                console.warn('No s\'ha pogut carregar snapshot canònic de taula, fent servir càlcul local:', snapshotErr);
            }
            return tablePages;
        } catch (err) {
            if (isAbortLikeError(err)) return [];
            logError('load-table-pages', err);
            return [];
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isAbortLikeError, resolvePageTableId, shouldIncludeTableRecord]);

    const loadPage = useCallback(async (pageId, fromHistory = false, attempt = 0) => {
        if (!pageId) return;
        // Si el wikilink ha passat un títol literal en lloc d'un UUID
        // (p.ex. "Resum estructurat del DVA"), el resolem ara contra
        // `globalIndex` o `pages`. Sense això, GET /api/vault/pages/<títol>
        // retorna 404. globalIndex pot estar buit en la primera càrrega
        // si la cerca és immediata; per això hi ha un segon fallback a
        // `pages` i un tercer fallback al backend (`/resolve-by-title`)
        // — aquest darrer cobreix moves on globalIndex encara no s'ha
        // refrescat al frontend.
        const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!UUID_RE.test(pageId)) {
            const lower = String(pageId).toLowerCase().trim();
            let resolved = null;
            // 1) globalIndex
            for (const [id, title] of Object.entries(globalIndex || {})) {
                if (String(title || '').toLowerCase().trim() === lower) {
                    resolved = id;
                    break;
                }
            }
            // 2) Llista local de pages
            if (!resolved) {
                const match = (pagesRef.current || pages).find(
                    p => String(p.title || '').toLowerCase().trim() === lower
                );
                if (match) resolved = match.id;
            }
            // 3) Backend (/resolve-by-title) — tolerant a moves recents.
            if (!resolved) {
                try {
                    const r = await axios.get('/api/vault/resolve-by-title', { params: { title: pageId } });
                    if (r?.data?.id) resolved = r.data.id;
                } catch { /* ignore — caurem al 404 estàndard */ }
            }
            if (resolved && resolved !== pageId) {
                pageId = resolved;
            }
        }
        const tabId = pageId;
        const existingTab = tabs.find(t => t.id === tabId);
        if (existingTab) {
            // Cap petició en vol: només canviem el focus.
            if (activeLoadAbortRef.current) {
                activeLoadAbortRef.current.abort();
                activeLoadAbortRef.current = null;
            }
            setActiveTabId(tabId);
            setViewMode('editor');
            setActiveTableId(null);
            if (!fromHistory) pushToHistory({ type: 'editor', id: pageId });
            return;
        }

        // ATENCIÓ: si l'usuari fa doble-click al MATEIX wikilink, abans
        // avortàvem el primer loadPage i el segon reutilitzava la
        // requestPromise avortada → loadPage fallava silenciosament i
        // calia 2-3 clicks més perquè finalment funcionés. Si el mateix
        // pageId ja s'està carregant, no avortem; deixem que la primera
        // crida acabi i sortim sense fer res.
        const inFlightForSamePage = pageRequestInFlightRef.current.has(pageId);
        if (inFlightForSamePage) {
            // Esperem el resultat de la primera crida i, quan acabi,
            // setActiveTabId per assegurar el focus a la pàgina nova.
            try {
                const res = await pageRequestInFlightRef.current.get(pageId);
                if (res?.data) {
                    setActiveTabId(tabId);
                    setViewMode('editor');
                    setActiveTableId(null);
                    if (!fromHistory) pushToHistory({ type: 'editor', id: pageId });
                }
            } catch { /* la primera crida ja informarà errors */ }
            return;
        }

        // Avortem només si la càrrega anterior era d'un pageId DIFERENT
        // (l'usuari ha canviat de target). Per al mateix pageId acabem
        // de tractar-ho a sobre.
        if (activeLoadAbortRef.current) {
            activeLoadAbortRef.current.abort();
        }
        const controller = new AbortController();
        activeLoadAbortRef.current = controller;

        try {
            const res = await fetchPageById(pageId, 1, controller.signal);
            if (controller.signal.aborted) return;
            if (!res) return;
            const pageData = res.data;
            const tableIdOfPage = resolvePageTableId(pageData);
            if (tableIdOfPage) await fetchPagesByTable(tableIdOfPage);
            if (controller.signal.aborted) return;

            const newTab = {
                id: tabId,
                title: pageData.title || t('common.untitled'),
                content: pageData.content || "",
                metadata: pageData.metadata || {},
                isTable: false
            };
            setTabs(prev => (prev.some(t => t.id === newTab.id) ? prev : [...prev, newTab]));
            setActiveTabId(tabId);
            setViewMode('editor');
            setActiveTableId(null);
            if (!fromHistory) pushToHistory({ type: 'editor', id: pageId });
        } catch (err) {
            if (controller.signal.aborted || isAbortLikeError(err)) {
                // Aborted by a newer loadPage — silenciós, no és un error real.
                if (controller.signal.aborted) return;
                if (attempt < 2) {
                    setTimeout(() => loadPage(pageId, fromHistory, attempt + 1), 400);
                    return;
                }
            }
            notifyError('load-page', err, t('errors.load_page'));
        } finally {
            if (activeLoadAbortRef.current === controller) {
                activeLoadAbortRef.current = null;
            }
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fetchPageById, fetchPagesByTable, isAbortLikeError, pushToHistory, resolvePageTableId, tabs]);

    const handleUpdateNote = useCallback(async (id, data) => {
        try {
            await axios.patch(`/api/vault/pages/${id}`, data);
            await fetchPages();
            const page = pages.find(p => p.id === id);
            const tableIdOfPage = resolvePageTableId(page);
            if (tableIdOfPage) await fetchPagesByTable(tableIdOfPage);
        } catch (err) {
            notifyError('update-note', err, t('errors.save_note'));
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fetchPages, fetchPagesByTable, pages, resolvePageTableId]);

    // Mou una pàgina del wiki sota un nou pare (drag & drop a la sidebar).
    // Si newParentId és null, la pàgina passa a ser root.
    const handleMovePage = useCallback(async (pageId, newParentId) => {
        if (!pageId) return;
        if (pageId === newParentId) return;
        // Update optimista del state local: la sidebar reflecteix immediatament
        // el canvi mentre el PATCH viatja.
        setPages(prev => prev.map(p => p.id === pageId
            ? { ...p, parent_id: newParentId, metadata: { ...(p.metadata || {}), parent_id: newParentId } }
            : p
        ));
        try {
            await axios.patch(`/api/vault/pages/${pageId}`, {
                parent_id: newParentId,
                metadata: { parent_id: newParentId },
            });
            toast.success(t('success.page_moved') || 'Pàgina moguda');
            void fetchPages();
            // Refresca globalIndex perquè els wikilinks per títol segueixin
            // resolent correctament (idToTitle s'usa al BlockEditor sense
            // re-fetch automàtic). Sense això, després d'un move pot quedar
            // stale fins a la propera càrrega.
            void fetchGlobalIndex();
        } catch (err) {
            notifyError('move-page', err, t('errors.move_page'));
            // Roll back optimistic update on error
            void fetchPages();
        }
    }, [fetchPages, t]);

    const ensureMainViewForTable = useCallback((tableViews = [], tableId = null) => {
        if (!Array.isArray(tableViews) || tableViews.length === 0) {
            return [{
                id: 'default',
                table_id: tableId,
                name: MAIN_VIEW_NAME,
                type: 'table',
                sort: { field: 'last_modified', direction: 'desc' },
                filters: [],
                is_main: true,
            }];
        }

        return tableViews.map(v => ({
            ...v,
            is_main: isMainView(v, tableViews),
        }));
    }, []);

    const getTableViews = useCallback((tableId) => {
        const persisted = registry.views?.filter(v => v.table_id === tableId) || [];
        const localOnly = views.filter(v => v.table_id === tableId && !persisted.find(pv => pv.id === v.id));
        return ensureMainViewForTable([...persisted, ...localOnly], tableId);
    }, [registry.views, views, ensureMainViewForTable]);

    const getPreferredInitialViewId = useCallback((tableViews = []) => {
        if (!Array.isArray(tableViews) || tableViews.length === 0) return 'default';
        const normalized = ensureMainViewForTable(tableViews);
        const preferredView = normalized.find(v => v.is_main) || normalized.find(v => v.type === 'table') || normalized[0];
        return preferredView?.id || 'default';
    }, [ensureMainViewForTable]);

    const fetchGlobalIndex = async () => {
        try {
            const res = await axios.get('/api/vault/global-index');
            setGlobalIndex(res.data);
        } catch (err) {
            console.error("Error carregant índex global:", err);
        }
    };

    const saveViews = async (updatedViews, databaseId) => {
        try {
            await axios.post(`/api/vault/views?folder=${databaseId}`, updatedViews);
            setViews(updatedViews);
        } catch (err) {
            console.error(err);
            toast.error(t('errors.save_view'));
        }
    };

    const handleUpdateView = async (updatedView) => {
        if (!updatedView || !updatedView.id) return;
        try {
            const tableId = updatedView.table_id || activeTableId;
            const tableSchema = getSchemaFromTableId(tableId);
            const tableViews = getTableViews(tableId);
            const main = isMainView(updatedView, tableViews);
            const normalizedView = {
                ...updatedView,
                is_main: main,
                ...(main ? { visibleProperties: getSchemaFieldNames(tableSchema) } : {}),
            };

            await axios.put(`/api/vault/views/${updatedView.id}`, normalizedView);
            await fetchRegistry();
            // Refresh current table pages to show possible new quick-entry records
            if (activeTableId) {
                await fetchPagesByTable(activeTableId);
            }
        } catch (err) {
            console.error("Error actualitzant vista:", err);
            toast.error(t('errors.save_view'));
        }
    };

    const handleDuplicateView = async (targetView) => {
        const viewId = typeof targetView === 'string' ? targetView : targetView.id;
        const view = (registry.views?.find(v => v.id === viewId)) || 
                     (typeof targetView === 'object' ? targetView : null);
        
        if (!view) return;
        
        const newView = {
            ...view,
            id: uuidv4(),
            name: `${view.name} (${t('common.copy')})`,
            order: (view.order !== undefined ? view.order : 0) + 0.5,
            table_id: view.table_id || activeTableId,
            is_main: false,
        };
        try {
            await axios.post('/api/vault/views', newView);
            await fetchRegistry();
            setActiveViewId(newView.id);
            toast.success(t('success.view_duplicated'));
        } catch (err) {
            console.error("Error duplicant vista:", err);
            toast.error(t('success.view_duplicated')); // Oops, I should have an error key for duplication failure
        }
    };

    const handleDeleteView = (targetView) => {
        const view = typeof targetView === 'object' ? targetView : registry.views?.find(v => v.id === targetView);
        if (!view) return;
        const tableViews = getTableViews(view.table_id || activeTableId);
        if (isMainView(view, tableViews)) {
            toast.error(t('errors.delete_main_view'));
            return;
        }
        setViewToDelete(view);
    };

    const executeDeleteView = async () => {
        if (!viewToDelete) return;
        try {
            await axios.delete(`/api/vault/views/${viewToDelete.id}`);
            await fetchRegistry();
            if (activeViewId === viewToDelete.id) {
                const remaining = (registry.views || [])
                    .filter(v => v.table_id === viewToDelete.table_id && v.id !== viewToDelete.id);
                setActiveViewId(remaining[0]?.id || 'default');
            }
            handleTabClose(viewToDelete.id);
            toast.success(t('success.view_deleted'));
        } catch (err) {
            console.error("Error eliminant vista:", err);
            toast.error(t('errors.delete_view'));
        } finally {
            setViewToDelete(null);
        }
    };

    const handleReorderViews = async (reorderedViews) => {
        // Persisteix l'ordre via un únic PUT atomic (no race condition amb
        // POSTs concurrents que no movien les entrades del registry).
        if (!Array.isArray(reorderedViews) || reorderedViews.length === 0) return;
        const tableId = reorderedViews[0]?.table_id;
        if (!tableId) return;
        const orderedIds = reorderedViews.map(v => v.id);
        // Optimistic UI: actualitza el state local abans del round-trip.
        setViews(reorderedViews);
        try {
            await axios.put('/api/vault/views/order', {
                table_id: tableId,
                ordered_ids: orderedIds,
            });
            await fetchRegistry();
        } catch (err) {
            console.error("Error reordenant vistes:", err);
            toast.error(t('errors.reorder_views') || 'Error reordenant vistes');
            await fetchRegistry();
        }
    };

    const handleRenameView = (targetView) => {
        const viewId = typeof targetView === 'string' ? targetView : targetView.id;
        const view = (registry.views?.find(v => v.id === viewId)) || 
                     (typeof targetView === 'object' ? targetView : null);
        
        if (!view) return;

        setPromptModal({
            isOpen: true,
            defaultTitle: view.name,
            inputValue: view.name,
            isView: true,
            isRename: true,
            targetView: view,
            isLoading: false
        });
    };

    const handleAddNewNote = useCallback(async (tableId, templateId = null) => {
        try {
            const normalizedTemplateId = typeof templateId === 'string' ? templateId : null;
            let initialContent = "";
            let initialMeta = { table_id: tableId, database_table_id: tableId };
            let title = "Nou";

            if (normalizedTemplateId) {
                const getRes = await axios.get(`/api/vault/pages/${normalizedTemplateId}`);
                const templateData = getRes.data;
                initialContent = templateData.content || "";
                title = templateData.title || "Nou";
                initialMeta = {
                    ...templateData.metadata,
                    is_template: false,
                    table_id: tableId,
                    database_table_id: tableId,
                    id: undefined
                };
            } else {
                // Use default template if available and no specific templateId is provided
                const defaultTemplate = tableTemplates.find(t => t.metadata?.is_default_template);
                if (defaultTemplate) {
                    const getRes = await axios.get(`/api/vault/pages/${defaultTemplate.id}`);
                    const templateData = getRes.data;
                    initialContent = templateData.content || "";
                    title = templateData.title || t('common.new');
                    initialMeta = {
                        ...templateData.metadata,
                        is_template: false,
                        table_id: tableId,
                        database_table_id: tableId,
                        id: undefined
                    };
                }
            }

            initialMeta = applySchemaDefaults(tableId, initialMeta, title);

            const res = await axios.post(`/api/vault/pages`, {
                title: title,
                content: initialContent,
                is_database: false,
                metadata: initialMeta
            });

            await fetchPages();
            toast.success(t('success.record_created'));
            loadPage(res.data.id);
        } catch (err) {
            console.error("Error creant el registre:", err);
            toast.error("Error creant el registre");
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tableTemplates, fetchPages, loadPage]);


    // callback invoked when user wants to configure an existing or new view
    const handleConfigureView = (view) => {
        setViewToConfigure(view);
        setIsViewConfigOpen(true);
        // if view is an existing one, pendingView remains null
    };

    const handleSaveViewConfig = async (config) => {
        if (viewToConfigure) {
            const updated = { ...viewToConfigure, ...config };
            if (pendingView && pendingView.id === viewToConfigure.id) {
                // this is a new view that needs to be created
                // assign default visibleProperties if not set
                if (!updated.visibleProperties) {
                    updated.visibleProperties = getSchemaFieldNames(schema);
                }
                if (registry && registry.views) {
                    await axios.post(`/api/vault/views`, updated);
                    await fetchRegistry();
                    setActiveViewId(updated.id);
                } else if (activeTabId) {
                    const updatedList = [...views, updated];
                    await saveViews(updatedList, activeTabId);
                    setActiveViewId(updated.id);
                }
                setPendingView(null);
            } else {
                // update existing view
                await handleUpdateView(updated);
            }
        }
    };

    const handleAddView = (type) => {
        // open prompt to ask name, we will follow up with config
        setPromptModal({
            isOpen: true,
            defaultTitle: `Nova Vista (${type})`,
            parentId: null,
            isDatabase: false,
            isDrawing: false,
            isView: true,
            viewType: type,
            inputValue: `Nova Vista`,
            isLoading: false
        });
    };

    useEffect(() => {
        fetchPages();
        fetchRegistry();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Avortar totes les peticions pendents quan es desmunta el component
    // (eviten "setState on unmounted component" warnings i memory leaks).
    useEffect(() => {
        return () => {
            if (activeLoadAbortRef.current) {
                activeLoadAbortRef.current.abort();
                activeLoadAbortRef.current = null;
            }
            pageRequestAbortersRef.current.forEach((controller) => {
                try { controller.abort(); } catch { /* noop */ }
            });
            // eslint-disable-next-line react-hooks/exhaustive-deps
            pageRequestAbortersRef.current.clear();
        };
    }, []);

    // Sincronitzar URL -> Estat Intern
    useEffect(() => {
        if (!nestedPath || !registry.tables) return;

        const parts = nestedPath.split('/');
        // Casos: table/:id, table/:id/view/:id, page/:id, drawing, view/:id
        if (parts[0] === 'table' && parts[1]) {
            const tableId = parts[1];
            const viewId = parts[3]; // table/:id/view/:id
            // En una recàrrega (Cmd+R) aquest efecte s'executa abans que
            // /api/vault/registry resolgui: registry.tables encara és [] (truthy),
            // i handleTableSelect fixaria activeTableId però NO l'esquema (el guard
            // de registre de la línia ~1222 falla amb el registre buit). El re-run
            // posterior, ja amb el registre carregat, s'ignora perquè activeTableId
            // ja coincideix → l'esquema queda {} i no es renderitza cap columna.
            // Esperem que el registre conegui la taula perquè la selecció sencera
            // (esquema + vista inicial) es faci en una sola passada.
            if (!registry.tables?.some(t => t.id === tableId)) return;
            if (activeTableId !== tableId) {
                handleTableSelect(tableId, viewId, true);
            } else if (viewId && activeViewId !== viewId) {
                setActiveViewId(viewId);
            }
        } else if (parts[0] === 'page' && parts[1]) {
            const pageId = parts[1];
            if (activeTabId !== pageId) {
                loadPage(pageId, true);
            }
        } else if (parts[0] === 'drawing') {
            if (viewMode !== 'drawing') setViewMode('drawing');
        } else if (parts[0] === 'view' && parts[1]) {
            // Suport per rutes existents com /vault/view/areas
            const id = parts[1];
            // Intentar trobar si és una taula o una pàgina
            const table = registry.tables.find(t => t.id === id || t.name.toLowerCase() === id.toLowerCase());
            if (table && table.id !== activeTableId) {
                handleTableSelect(table.id, null, true);
            } else if (!table) {
                const page = pagesRef.current.find(p => p.id === id);
                if (page) loadPage(page.id, true);
            }
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [nestedPath, registry.tables]);

    useEffect(() => {
        const refreshActiveTable = () => {
            if (activeTableId) {
                void fetchPagesByTable(activeTableId);
            }
        };

        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                refreshActiveTable();
            }
        };

        window.addEventListener('focus', refreshActiveTable);
        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            window.removeEventListener('focus', refreshActiveTable);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [activeTableId, fetchPagesByTable]);

    // Sincronitzar tableNotes quan el snapshot del servidor s'actualitza (p.ex. després d'una eliminació)
    useEffect(() => {
        if (!activeTableId) return;
        const freshNotes = visibleTableRecordsById[activeTableId];
        if (freshNotes !== undefined) {
            setTableNotes(freshNotes);
        }
    }, [activeTableId, visibleTableRecordsById]);

    // Refs for the keyboard listener below — same pattern as undoRef/redoRef.
    // Otherwise the empty-deps useEffect captures stale versions of
    // `loadPage`, `closePromptModal` etc. (rebuilt every render) and:
    //   • Cmd+K / Escape end up reading first-render state (e.g. tabs list
    //     used to find an existing tab is empty → duplicate tabs created on
    //     subsequent opens of the same page)
    //   • the `vault-open-folder` event handler calls a stale loadPage so
    //     the "open existing tab" branch never matches.
    const loadPageRef = useRef(null);
    const closePromptModalRef = useRef(null);
    useEffect(() => { loadPageRef.current = loadPage; }, [loadPage]);
    useEffect(() => { closePromptModalRef.current = closePromptModal; }, [closePromptModal]);

    // Keyboard listeners for Cmd+K / Ctrl+K and Escape
    useEffect(() => {
        const handleKeyDown = (e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                e.preventDefault();
                setIsGlobalSearchOpen(open => !open);
            }
            if (e.key === 'Escape') {
                setIsGlobalSearchOpen(false);
                setIsRecentOpen(false);
                closePromptModalRef.current?.();
            }
        };

        const handleFolderOpen = (e) => {
            if (e.detail?.folder) {
                // Backwards compatibility for Database block clicks
                loadPageRef.current?.(e.detail.folder);
            }
        };

        // PDFs enllaçats des d'una pàgina del Vault o de fora: useFileLinkInterceptor
        // dispara aquest event amb { src, title }. Cancel·lem el default
        // perquè l'interceptor sàpiga que l'hem gestionat (no cal navegar a
        // /vault/pdf?src=... com a fallback).
        const handleOpenPdf = (e) => {
            const { src, title, kind } = e.detail || {};
            if (!src) return;
            e.preventDefault();
            // PDF / EPUB / snapshot HTML comparteixen prefix de tab (vegeu
            // PDF_TAB_PREFIX) perquè conceptualment són "documents" del
            // reader Zotero. El camp `kind` controla quin viewer concret
            // s'inicialitza dins l'iframe.
            const id = `${PDF_TAB_PREFIX}${src}`;
            setTabs(prev => {
                if (prev.some(t => t.id === id)) return prev;
                return [...prev, { id, title: title || 'document', isPdf: true, src, kind: kind || 'pdf' }];
            });
            setActiveTabId(id);
            setViewMode('editor');
            setActiveTableId(null);
        };

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('vault-open-folder', handleFolderOpen);
        window.addEventListener('gnosi:open-pdf', handleOpenPdf);

        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('vault-open-folder', handleFolderOpen);
            window.removeEventListener('gnosi:open-pdf', handleOpenPdf);
        };
    }, []);

    // Global Undo/Redo shortcuts (using refs to avoid stale closures)
    useEffect(() => {
        const handleUndoRedo = (e) => {
            if (!(e.metaKey || e.ctrlKey)) return;
            const tag = document.activeElement?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;
            if (e.key === 'z' && !e.shiftKey) {
                e.preventDefault();
                undoRef.current?.();
            } else if ((e.key === 'z' && e.shiftKey) || e.key === 'y') {
                e.preventDefault();
                redoRef.current?.();
            }
        };
        window.addEventListener('keydown', handleUndoRedo);
        return () => window.removeEventListener('keydown', handleUndoRedo);
    }, []);

    const handleTableSelect = useCallback(async (tableId, viewId = null, fromHistory = false) => {
        // Si ja hi ha una pestanya de taula oberta, canviar el focus a ella
        const existingTableTab = tabs.find(t => t.isTable && getTableIdFromTab(t) === tableId);
        if (existingTableTab) {
            if (!fromHistory) pushToHistory({ type: 'table', id: tableId, subId: viewId });
            setActiveTabId(existingTableTab.id);
            setActiveTableId(tableId);
            setViewMode('editor');
            if (viewId) setActiveViewId(viewId);
            return;
        }
        // Si la taula ja és la vista activa inline i no hi ha canvi de vista, no fer res
        if (!fromHistory && activeTableId === tableId && !viewId) return;

        if (!fromHistory) {
            pushToHistory({ type: 'table', id: tableId, subId: viewId });
        }
        setActiveTableId(tableId);
        setViewMode('table');
        setActiveTabId(null);

        // Search for notes belonging to this table.
        // Single source: resolved_table_id (backend). Legacy fallback: metadata table_id/database_table_id.
        const matchesTable = (p) => {
            const resolvedTableId = resolvePageTableId(p);
            return resolvedTableId === tableId;
        };
        const filtered = getTableVisibleRecords(tableId);
        setTableNotes(filtered);

        // Search for templates for this table
        const templates = pages.filter(p => matchesTable(p) && p.metadata?.is_template);
        setTableTemplates(templates);
        void fetchPagesByTable(tableId);
        if (registry.tables.find(t => t.id === tableId)) {
            setSchema(getSchemaFromTableId(tableId));
        }

        // Get default view for table
        // Reset views state to prevent stale views from other tables
        setViews([]);
        setActiveViewId(null);

        // Find existing views in registry for this table to set as initial active view
        const tableViews = registry.views?.filter(v => v.table_id === tableId) || [];
        if (viewId) {
            setActiveViewId(viewId);
        } else {
            setActiveViewId(getPreferredInitialViewId(tableViews));
        }
        // Instant migration of old tables to views system: if no views
        // exist for this table, create a default one.
        //
        // The `!isRegistryLoading` guard is critical — without it, opening a
        // table while the initial /api/vault/registry fetch is still in
        // flight would see an empty `registry.views` array and trigger an
        // auto-creation, even though a main view already exists on disk.
        // That's exactly how duplicate "Vista principal" rows piled up on
        // every page reload.
        if (
            !isRegistryLoading &&
            Array.isArray(registry.views) &&
            tableViews.length === 0 &&
            !viewCreationInProgressRef.current.has(tableId)
        ) {
            const defaultId = uuidv4();
            viewCreationInProgressRef.current.add(tableId);
            axios.post(`/api/vault/views`, {
                id: defaultId,
                table_id: tableId,
                name: MAIN_VIEW_NAME,
                type: "table",
                sort: { field: "last_modified", direction: "desc" },
                filters: [],
                is_main: true,
            }).then(() => fetchRegistry()).catch(err => console.error("Error auto-creating view:", err))
              .finally(() => viewCreationInProgressRef.current.delete(tableId));
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pushToHistory, setActiveTableId, setViewMode, setActiveTabId, resolvePageTableId, getTableVisibleRecords, setTableNotes, pages, setTableTemplates, fetchPagesByTable, registry.tables, registry.views, getSchemaFromTableId, setViews, setActiveViewId, getPreferredInitialViewId, fetchRegistry, tabs, getTableIdFromTab, activeTableId]);

    const handleEditorUpdate = useCallback((pageId, content, payload = {}) => {
        setTabs(prevTabs => prevTabs.map(tab => {
            if (tab.id !== pageId) return tab;

            // Si `content` és `undefined`, l'editor només ha actualitzat
            // metadata (p.ex. rename del títol via panell o header). Mantenim
            // el contingut existent — sense aquest fallback, perdíem el body
            // de la pestanya cada cop que es renombrava la pàgina.
            return {
                ...tab,
                content: content !== undefined ? content : tab.content,
                title: payload?.title ?? tab.title,
                metadata: payload?.metadata ?? tab.metadata,
            };
        }));

        // Propaga el canvi al state global `pages` i al cache
        // `visibleTableRecordsById` perquè, en tornar a una vista (Table,
        // Gallery, Kanban, Feed) després de tancar la pestanya, hi vegis
        // immediatament el nou títol/metadata/contingut sense haver de fer
        // refresh manual. Sense això, la vista llegeix del cache anterior i
        // mostra dades stale fins al pròxim `fetchPages`.
        const nextTitle = payload?.title;
        const nextMetadata = payload?.metadata;
        const applyPatch = (page) => {
            const updated = { ...page };
            if (content !== undefined) updated.content = content;
            if (nextTitle !== undefined) updated.title = nextTitle;
            if (nextMetadata !== undefined) updated.metadata = nextMetadata;
            return updated;
        };
        setPages(prev => {
            let mutated = false;
            const next = prev.map(p => {
                if (p.id !== pageId) return p;
                mutated = true;
                return applyPatch(p);
            });
            if (!mutated) return prev;
            pagesRef.current = next;
            return next;
        });
        setVisibleTableRecordsById(prev => {
            if (!prev) return prev;
            let changed = false;
            const next = {};
            for (const [tableId, records] of Object.entries(prev)) {
                if (!Array.isArray(records)) {
                    next[tableId] = records;
                    continue;
                }
                let tableChanged = false;
                const mapped = records.map(p => {
                    if (p.id !== pageId) return p;
                    tableChanged = true;
                    return applyPatch(p);
                });
                if (tableChanged) {
                    changed = true;
                    next[tableId] = mapped;
                } else {
                    next[tableId] = records;
                }
            }
            return changed ? next : prev;
        });
    }, []);


    const ensurePageTabLoaded = useCallback(async (pageId) => {
        const existingTab = tabs.find(t => t.id === pageId);
        if (existingTab) {
            return true;
        }

        try {
            const res = await fetchPageById(pageId, 1);

            const newTab = {
                id: pageId,
                title: res.data.title || "Sense Títol",
                content: res.data.content,
                metadata: {
                    ...(res.data.metadata || {}),
                    resolved_table_id: res.data.resolved_table_id || res.data.metadata?.resolved_table_id || null,
                },
                folder: res.data.folder || "",
                resolved_table_id: res.data.resolved_table_id || null
            };

            setTabs(prev => (prev.some(t => t.id === newTab.id) ? prev : [...prev, newTab]));
            return true;
        } catch (err) {
            if (isAbortLikeError(err)) {
                return false;
            }
            console.error(`Error trying to preload page ${pageId}`, err);
            toast.error(t('errors.open_parallel'));
            return false;
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tabs, fetchPageById, setTabs]);

    const handleTabClose = useCallback((tabId) => {
        setTabs(prevTabs => {
            const remainingTabs = prevTabs.filter(t => t.id !== tabId);
            
            setSplitTabIds(prevSplit => {
                const remainingSplitTabIds = prevSplit.filter(id => id !== tabId);
                
                if (activeTabId === tabId) {
                    const promotedPaneId = remainingSplitTabIds.find(id => remainingTabs.some(tab => tab.id === id)) || null;
                    const fallbackTabId = remainingTabs.length > 0 ? remainingTabs[remainingTabs.length - 1].id : null;
                    const nextActiveTabId = promotedPaneId || fallbackTabId;

                    if (nextActiveTabId) {
                        const nextTab = remainingTabs.find(tab => tab.id === nextActiveTabId);
                        setActiveTabId(nextActiveTabId);
                        setActiveTableId(nextTab?.isTable ? getTableIdFromTab(nextTab) : null);
                        setViewMode(nextTab?.isDrawing ? 'drawing' : 'editor');
                        return remainingSplitTabIds.filter(id => id !== nextActiveTabId);
                    } else if (splitTableIds.length > 0) {
                        const promotedTableId = splitTableIds[0];
                        setSplitTableIds(prev => prev.filter(id => id !== promotedTableId));
                        handleTableSelect(promotedTableId);
                        return remainingSplitTabIds;
                    } else {
                        setActiveTabId(null);
                        return remainingSplitTabIds;
                    }
                }
                return remainingSplitTabIds;
            });
            
            return remainingTabs;
        });
    }, [activeTabId, splitTableIds, handleTableSelect]);

    useEffect(() => {
        // No filtrar tabs mentre les dades globals encara s'estan carregant.
        // Sense aquesta guarda, obrir el dashboard amb URL directa
        // /vault/page/<id> tancava el tab que loadPage acabava d'obrir
        // (perquè `pages` encara era [] quan corria l'efecte) i el dashboard
        // queia al "Benvinguda" en lloc de mostrar la pàgina demanada.
        if (loading || isRegistryLoading) return;

        const existingPageIds = new Set(pages.map(page => page.id));
        const existingTableIds = new Set((registry.tables || []).map(table => table.id));

        setTabs(prevTabs => {
            const filteredTabs = prevTabs.filter(tab => {
                if (tab.isTable) {
                    const tableId = getTableIdFromTab(tab);
                    return Boolean(tableId && existingTableIds.has(tableId));
                }
                // Pestanyes PDF i drawings no viuen al `pages` registry —
                // són pestanyes "volàtils" que la sessió manté en memòria.
                // No s'haurien de filtrar perquè no formen part del catàleg.
                if (tab.isPdf || tab.isDrawing) return true;
                return existingPageIds.has(tab.id);
            });

            if (filteredTabs.length === prevTabs.length) {
                return prevTabs;
            }

            const validTabIds = new Set(filteredTabs.map(tab => tab.id));
            setSplitTabIds(prev => prev.filter(id => validTabIds.has(id)));

            if (activeTabId && !validTabIds.has(activeTabId)) {
                const fallbackTab = filteredTabs[filteredTabs.length - 1] || null;
                if (fallbackTab) {
                    setActiveTabId(fallbackTab.id);
                    setActiveTableId(fallbackTab.isTable ? getTableIdFromTab(fallbackTab) : null);
                    setViewMode(fallbackTab.isDrawing ? 'drawing' : 'editor');
                } else {
                    setActiveTabId(null);
                }
            }

            return filteredTabs;
        });

        setSplitTableIds(prev => prev.filter(tableId => existingTableIds.has(tableId)));

        if (activeTableId && !existingTableIds.has(activeTableId)) {
            setActiveTableId(null);
            if (viewMode === 'table') {
                setViewMode('editor');
            }
        }
    }, [activeTabId, activeTableId, pages, registry.tables, viewMode, loading, isRegistryLoading]);

    const MAX_PANES = 4;

    const handleToggleSplit = useCallback((tabId) => {
        if (tabId === activeTabId) return;

        setSplitTabIds(prev => {
            if (prev.includes(tabId)) return prev.filter(id => id !== tabId);
            if (prev.length + splitTableIds.length + 1 >= MAX_PANES) return prev; // already have active + prev
            return [...prev, tabId];
        });
    }, [activeTabId, splitTableIds.length]);

    const handleOpenParallel = useCallback(async (pageId) => {
        if (pageId === activeTabId) return;

        const loaded = await ensurePageTabLoaded(pageId);
        if (!loaded) return;

        setSplitTabIds(prev => {
            if (prev.includes(pageId)) return prev;
            if (prev.length + splitTableIds.length + 1 >= MAX_PANES) return prev;
            return [...prev, pageId];
        });
    }, [activeTabId, ensurePageTabLoaded, splitTableIds.length]);

    // Reemplaça la tab activa per la pàgina destí (semàntica "same tab" del navegador).
    // Si la pàgina destí ja és la activa, no fa res.
    // Si no hi ha cap tab activa, equival a `loadPage` (afegir + focus).
    const handleOpenInCurrentTab = useCallback(async (pageId) => {
        if (!pageId) return;
        if (pageId === activeTabId) return;

        const previousTabId = activeTabId;

        await loadPage(pageId);

        // Tanca la tab anterior només si segueix existint i no s'ha promogut a la nova.
        if (previousTabId && previousTabId !== pageId) {
            setTabs(prev => prev.filter(t => t.id !== previousTabId));
            setSplitTabIds(prev => prev.filter(id => id !== previousTabId));
        }
    }, [activeTabId, loadPage]);

    const handleOpenTableParallel = useCallback((tableId) => {
        if (!activeTabId) {
            const fallbackTabId = tabs.length > 0 ? tabs[tabs.length - 1].id : null;
            if (!fallbackTabId) {
                toast.error(t('errors.open_parallel_first'));
                return;
            }
            setActiveTabId(fallbackTabId);
            setViewMode('editor');
        }

        setSplitTableIds(prev => {
            if (prev.includes(tableId)) return prev;
            if (splitTabIds.length + prev.length + 1 >= MAX_PANES) return prev;
            return [...prev, tableId];
        });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeTabId, splitTabIds.length, tabs, setActiveTabId, setViewMode]);

    const handleDuplicateTemplate = async (template) => {
        try {
            await axios.post(`/api/vault/pages`, {
                title: `${template.title} (${t('common.copy')})`,
                content: template.content || "",
                is_database: false,
                metadata: {
                    ...template.metadata,
                    id: undefined
                }
            });
            toast.success(t('success.template_duplicated'));
            const tableIdOfPage = resolvePageTableId(template);
            if (tableIdOfPage) {
                await fetchPagesByTable(tableIdOfPage);
            }
        } catch {
            toast.error(t('errors.template_duplicate'));
        }
    };

    const handleSetDefaultTemplate = async (template) => {
        try {
            const targetTableId = resolvePageTableId(template);
            const otherTemplates = pages.filter(p => resolvePageTableId(p) === targetTableId && p.metadata?.is_template && p.id !== template.id && p.metadata?.is_default_template);
            
            for (const t of otherTemplates) {
                await axios.patch(`/api/vault/pages/${t.id}`, {
                    ...t,
                    metadata: { ...t.metadata, is_default_template: false }
                });
            }

            await axios.patch(`/api/vault/pages/${template.id}`, {
                ...template,
                metadata: { ...template.metadata, is_default_template: true }
            });
            toast.success(t('success.template_default_set'));
            if (targetTableId) {
                await fetchPagesByTable(targetTableId);
            }
        } catch {
            toast.error(t('errors.template_default'));
        }
    };

    const handleCreateRecordForTable = async (targetTableId, templateId = null) => {
        try {
            let normalizedTemplateId = typeof templateId === 'string' ? templateId : null;
            if (!normalizedTemplateId) {
                const tableTemplates = pages.filter(p => resolvePageTableId(p) === targetTableId && p.metadata?.is_template);
                const defaultTemplate = tableTemplates.find(t => t.metadata?.is_default_template);
                if (defaultTemplate) {
                    normalizedTemplateId = defaultTemplate.id;
                }
            }
            
            let initialContent = "";
            let initialMeta = { table_id: targetTableId, database_table_id: targetTableId };
            let title = "Nou";

            if (normalizedTemplateId) {
                const getRes = await axios.get(`/api/vault/pages/${normalizedTemplateId}`);
                const templateData = getRes.data;
                initialContent = templateData.content || "";
                title = templateData.title || "Nou";
                initialMeta = {
                    ...templateData.metadata,
                    is_template: false,
                    is_default_template: false,
                    table_id: targetTableId,
                    database_table_id: targetTableId,
                    id: undefined
                };
            }

            initialMeta = applySchemaDefaults(targetTableId, initialMeta, title);

            const res = await axios.post(`/api/vault/pages`, {
                title: title,
                content: initialContent,
                is_database: false,
                metadata: initialMeta
            });
            await fetchPagesByTable(targetTableId);
            loadPage(res.data.id);
        } catch {
            toast.error("Error creant el registre");
        }
    };

    const handleOpenTableAsTab = async (tableId) => {
        try {
            const existingTab = tabs.find(t => t.isTable && getTableIdFromTab(t) === tableId);
            if (existingTab) {
                pushToHistory({ type: 'table', id: tableId });
                setActiveTabId(existingTab.id);
                setActiveTableId(tableId);
                setViewMode('editor');
                return;
            }

            const table = registry.tables?.find(t => t.id === tableId);
            if (!table) {
                toast.error(t('errors.table_not_found'));
                return;
            }

            const newTab = {
                id: buildTableTabId(tableId),
                title: table.name || t('common.untitled'),
                isTable: true,
                tableId
            };

            setTabs(prev => (prev.some(t => t.id === newTab.id && t.isTable) ? prev : [...prev, newTab]));
            pushToHistory({ type: 'table', id: tableId });
            setActiveTabId(newTab.id);
            setViewMode('editor');
            setActiveTableId(tableId);

            // Fetch table data
            const matchesTable = (p) => {
                const resolvedTableId = resolvePageTableId(p);
                return resolvedTableId === tableId;
            };
            const filtered = getVisibleTableRecords(pages, tableId);
            setTableNotes(filtered);

            const templates = pages.filter(p => matchesTable(p) && p.metadata?.is_template);
            setTableTemplates(templates);
            void fetchPagesByTable(tableId);

            if (table) {
                setSchema(getSchemaFromTableId(tableId));
            }

            setViews([]);
            setActiveViewId(null);

            const tableViews = registry.views?.filter(v => v.table_id === tableId) || [];
            setActiveViewId(getPreferredInitialViewId(tableViews));

            // Same guard as in handleTableOpen above: never auto-create a
            // default view while the registry is still loading — the empty
            // array there is "we don't know yet", not "no views exist".
            if (
                !isRegistryLoading &&
                Array.isArray(registry.views) &&
                tableViews.length === 0 &&
                !viewCreationInProgressRef.current.has(tableId)
            ) {
                const defaultId = uuidv4();
                viewCreationInProgressRef.current.add(tableId);
                axios.post(`/api/vault/views`, {
                    id: defaultId,
                    table_id: tableId,
                    name: MAIN_VIEW_NAME,
                    type: "table",
                    sort: { field: "last_modified", direction: "desc" },
                    filters: [],
                    is_main: true,
                }).then(() => fetchRegistry()).catch(err => console.error("Error auto-creating view:", err))
                  .finally(() => viewCreationInProgressRef.current.delete(tableId));
            }
        } catch (err) {
            console.error("Error obrint la taula:", err);
            toast.error(t('errors.open_table')); // Add error.open_table if missing
        }
    };

    const handleTabSelect = (tabId) => {
        const tab = tabs.find(t => t.id === tabId);
        if (!tab) return;

        if (tab.isDrawing) {
            pushToHistory({ type: 'drawing', id: tabId });
        } else if (tab.isTable) {
            const tableId = getTableIdFromTab(tab);
            if (tableId) {
                pushToHistory({ type: 'table', id: tableId });
            }
        } else if (!tab.isPdf) {
            // PDF tabs no van a l'history de navegació (no tenen ruta canonical
            // dins el Vault) — només són d'una sessió. Reactiu a obrir-los
            // de nou amb el mateix link.
            pushToHistory({ type: 'editor', id: tabId });
        }

        setActiveTabId(tabId);

        if (tab.isDrawing) {
            setViewMode('drawing');
            setActiveTableId(null);
            return;
        }

        setViewMode('editor');

        if (tab.isTable) {
            setActiveTableId(getTableIdFromTab(tab));
            return;
        }

        setActiveTableId(null);
    };

    const handleOpenCreatePrompt = (parentId = null, isDatabase = false, isDrawing = false, isDashboard = false) => {
        let defaultTitle = isDatabase ? t('common.new_database') : t('common.new_page');
        if (isDrawing) defaultTitle = t('common.new_drawing');
        if (isDashboard) defaultTitle = t('common.new_dashboard');
        setPromptModal({ 
            isOpen: true, 
            defaultTitle, 
            parentId, 
            isDatabase, 
            isDrawing, 
            isDashboard,
            isView: false,
            isRename: false,
            targetView: null,
            viewType: null,
            inputValue: defaultTitle, 
            isLoading: false 
        });
    };

    const executeCreateContent = async (e) => {
        if (e) e.preventDefault();
        const { inputValue, parentId, isDatabase, isDrawing, isDashboard, isView, isRename, viewType, isTemplate, isApp, databaseId } = promptModal;
        const title = inputValue?.trim();

        if (!title) {
            closePromptModal();
            return;
        }

        try {
            setPromptModal(prev => ({ ...prev, isLoading: true }));

            if (isTemplate) {
                const res = await axios.post(`/api/vault/pages`, {
                    title: title,
                    content: ``,
                    is_database: false,
                    metadata: {
                        is_template: true,
                        table_id: activeTableId,
                        database_table_id: activeTableId
                    }
                });
                await fetchPages();
                toast.success(t('success.template_created')); // Add success.template_created
                loadPage(res.data.id);
            } else if (isApp) {
                await axios.post('/api/vault/databases', { name: title });
                await fetchRegistry();
                toast.success(t('success.app_created', { name: title }));
            } else if (isRename) {
                const view = promptModal.targetView;
                if (!view) throw new Error("No view selected for renaming");

                const viewId = view.id;
                const isDefault = viewId === 'default' || !registry.views?.find(v => v.id === viewId);
                const updated = { ...view, name: title };

                if (isDefault) {
                    const newView = {
                        ...view,
                        id: uuidv4(),
                        table_id: view.table_id || activeTableId,
                        name: title,
                        order: 0,
                        is_main: true,
                    };
                    await axios.post('/api/vault/views', newView);
                    setActiveViewId(newView.id);
                } else {
                    await axios.put(`/api/vault/views/${viewId}`, updated);
                }
                await fetchRegistry();
                toast.success(t('success.view_renamed'));
            } else if (isView) {
                // build object but postpone saving until after user configures it
                const newView = {
                    id: uuidv4(),
                    table_id: activeTableId,
                    name: title,
                    type: viewType,
                    sort: { field: "last_modified", direction: "desc" },
                    filters: [],
                    // default visibleProperties is derived later
                };

                // keep pending view in state and open config modal
                setPendingView(newView);
                setViewToConfigure(newView);
                setIsViewConfigOpen(true);
            } else if (isDrawing) {
                const drawingId = uuidv4();
                await axios.put(`/api/vault/drawings/${drawingId}`, {
                    title: title,
                    data: {},
                    metadata: {}
                });
                setActiveTabId(drawingId);
                setViewMode('drawing');
                setTabs(prev => (prev.some(t => t.id === drawingId) ? prev : [...prev, { id: drawingId, title: title, isDrawing: true }]));
            } else if (isDatabase && databaseId) {
                // Taula dins d'una Database (App)
                const tableRes = await axios.post('/api/vault/tables', {
                    name: title,
                    database_id: databaseId,
                    properties: [{ name: "Status", type: "select" }]
                });
                await axios.post(`/api/vault/views`, {
                    id: uuidv4(),
                    table_id: tableRes.data.id,
                    name: MAIN_VIEW_NAME,
                    type: "table",
                    sort: { field: "last_modified", direction: "desc" },
                    filters: [],
                    is_main: true,
                });
                await fetchRegistry();
                toast.success(t('success.table_created', { name: title }));
            } else {
                const res = await axios.post(`/api/vault/pages`, {
                    title: title,
                    content: isDashboard ? '{\n  \n}' : ``,
                    parent_id: parentId,
                    is_database: isDatabase,
                    metadata: isDashboard
                        ? {
                            is_dashboard: true,
                            content_format: 'json',
                        }
                        : undefined,
                });
                await fetchPages();
                loadPage(res.data.id);
            }
            closePromptModal();
        } catch {
            toast.error("Error creant el contingut");
            setPromptModal(prev => ({ ...prev, isLoading: false }));
        }
    };

    // ---- ELIMINACIÓ INDIVIDUAL (soft-delete + toast amb "Desfer") ----
    // Soft-delete: el backend mou la pàgina a `.trash/{id}/`. Es pot restaurar
    // des del toast (durant uns segons) o des de la vista de paperera.
    // Vegeu docs/dev_memory/directives/vault_trash.md.
    const handleDeletePage = useCallback(async (pageId, pageTitle) => {
        if (!pageId) return;
        const id = pageId;
        const title = pageTitle || t('common.untitled') || 'Sense títol';

        const removeFromState = () => {
            setPages(prev => prev.filter(page => page.id !== id));
            setTableNotes(prev => prev.filter(note => note.id !== id));
            setVisibleTableRecordsById(prev => {
                const next = {};
                for (const [tableId, notes] of Object.entries(prev)) {
                    next[tableId] = (notes || []).filter(n => n.id !== id);
                }
                return next;
            });
            handleTabClose(id);
            if (nestedPath && nestedPath.includes(id)) {
                // Tornem al tab que `handleTabClose` ha promogut (típicament
                // el dashboard o la taula pare des d'on s'havia obert
                // l'entrada), enlloc de caure a `/vault` (pantalla "Hola"
                // buida) i deixar l'usuari descontextualitzat.
                const remaining = tabs.filter(tab => tab.id !== id);
                const fallback = remaining[remaining.length - 1];
                if (fallback?.isDrawing) {
                    pushToHistory({ type: 'drawing', id: fallback.id });
                } else if (fallback?.isTable) {
                    const tableId = getTableIdFromTab(fallback);
                    if (tableId) pushToHistory({ type: 'table', id: tableId });
                    else navigate('/vault');
                } else if (fallback) {
                    pushToHistory({ type: 'editor', id: fallback.id });
                } else {
                    navigate('/vault');
                }
            }
        };
        const refreshAfterDelete = () => {
            if (activeTableId) void fetchPagesByTable(activeTableId);
            else void fetchPages();
        };
        const restorePage = async () => {
            try {
                await axios.post(`/api/vault/pages/${id}/restore`);
                refreshAfterDelete();
                toast.success(t('success.page_restored') || 'Pàgina restaurada');
            } catch (err) {
                console.error('Error restaurant la pàgina:', err);
                toast.error(t('errors.restore_page') || 'No s\'ha pogut restaurar');
            }
        };

        try {
            await axios.delete(`/api/vault/pages/${id}`);
            removeFromState();
            refreshAfterDelete();
            toast((tObj) => (
                <span className="flex items-center gap-3">
                    <span className="truncate max-w-[16rem]">
                        "{title}" {t('vault.moved_to_trash') || 'mogut a la paperera'}
                    </span>
                    <button
                        type="button"
                        onClick={async () => {
                            toast.dismiss(tObj.id);
                            await restorePage();
                        }}
                        className="px-2 py-0.5 rounded text-xs font-semibold bg-[var(--gnosi-primary)] text-white hover:opacity-90"
                    >
                        {t('common.undo') || 'Desfer'}
                    </button>
                </span>
            ), { duration: 8000 });
        } catch (err) {
            // 404: ja no hi és al disc; neteja local i avís de fantasma.
            if (err?.response?.status === 404) {
                removeFromState();
                refreshAfterDelete();
                toast.success(t('success.page_deleted_ghost') || 'Pàgina eliminada (era un fantasma del cache)');
            } else {
                console.error('Error movent la pàgina a la paperera:', err);
                toast.error(t('errors.delete_page') || 'Error movent la pàgina a la paperera');
            }
        }
    }, [nestedPath, navigate, handleTabClose, fetchPages, fetchPagesByTable, activeTableId, t, tabs, pushToHistory]);

    // ---- ELIMINAR MÚLTIPLES REGISTRES (soft-delete + toast amb "Desfer") ----
    // Sense modal: el delete és reversible des del toast (8 s), des de Cmd+Z,
    // o des de la vista de paperera. Els errors parcials (alguns 4xx/5xx) es
    // mostren a banda, perquè no enganyem l'usuari amb un "fet" quan no és.
    const handleDeleteSelected = useCallback(async (selectedIds) => {
        const idArray = [...selectedIds];
        if (idArray.length === 0) return;

        const refreshAfter = () => {
            if (activeTableId) void fetchPagesByTable(activeTableId);
            else void fetchPages();
        };
        // Restore amb informe d'errors parcials. Retorna {succeeded, failed}.
        const restoreMany = async (ids) => {
            const results = await Promise.allSettled(
                ids.map(id => axios.post(`/api/vault/pages/${id}/restore`))
            );
            const succeeded = [];
            const failed = [];
            results.forEach((r, i) => {
                if (r.status === 'fulfilled') succeeded.push(ids[i]);
                else failed.push({ id: ids[i], status: r.reason?.response?.status });
            });
            refreshAfter();
            if (succeeded.length > 0) {
                toast.success(`Restaurats ${succeeded.length} registre${succeeded.length !== 1 ? 's' : ''}`);
            }
            if (failed.length > 0) {
                const reasons = failed.map(f => f.status || '?').join(', ');
                toast.error(`No s'han pogut restaurar ${failed.length} registre${failed.length !== 1 ? 's' : ''} (codis: ${reasons})`);
            }
            return { succeeded, failed };
        };

        // DELETE: 404 → tractat com a èxit (ja no és al disc; cal treure'l de
        // l'estat local igualment); 200/2xx → èxit; resta → fallat.
        const deleteResults = await Promise.allSettled(
            idArray.map(id => axios.delete(`/api/vault/pages/${id}`))
        );
        const deletedIds = [];
        const failedDeletes = [];
        deleteResults.forEach((r, i) => {
            const id = idArray[i];
            if (r.status === 'fulfilled') {
                deletedIds.push(id);
            } else if (r.reason?.response?.status === 404) {
                deletedIds.push(id);
            } else {
                failedDeletes.push({ id, status: r.reason?.response?.status });
            }
        });

        // Optimistic update només per als ids confirmats.
        setPages(prev => prev.filter(p => !deletedIds.includes(p.id)));
        setTableNotes(prev => prev.filter(p => !deletedIds.includes(p.id)));
        setVisibleTableRecordsById(prev => {
            const next = {};
            for (const [tableId, notes] of Object.entries(prev)) {
                next[tableId] = (notes || []).filter(n => !deletedIds.includes(n.id));
            }
            return next;
        });
        deletedIds.forEach(id => handleTabClose(id));

        if (deletedIds.length > 0) {
            setUndoStack(prev => [...prev, { type: 'delete', ids: deletedIds }]);
            setRedoStack([]);
        }
        refreshAfter();

        if (failedDeletes.length > 0) {
            const reasons = failedDeletes.map(f => f.status || '?').join(', ');
            toast.error(`No s'han pogut eliminar ${failedDeletes.length} registre${failedDeletes.length !== 1 ? 's' : ''} (codis: ${reasons})`);
        }

        if (deletedIds.length === 0) return;

        const count = deletedIds.length;
        toast((tObj) => (
            <span className="flex items-center gap-3">
                <span>
                    {count} registre{count !== 1 ? 's' : ''} mogut{count !== 1 ? 's' : ''} a la paperera
                </span>
                <button
                    type="button"
                    onClick={async () => {
                        toast.dismiss(tObj.id);
                        await restoreMany(deletedIds);
                    }}
                    className="px-2 py-0.5 rounded text-xs font-semibold bg-[var(--gnosi-primary)] text-white hover:opacity-90"
                >
                    Desfer
                </button>
            </span>
        ), { duration: 8000 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fetchPages, fetchPagesByTable, activeTableId, handleTabClose]);

    // ---- DESFER (Undo) — restaurar la darrera tongada eliminada ----
    // Si totes les restauracions fallen, no movem l'operació a redoStack: la
    // mantenim a undoStack per permetre reintents. Si la fallida és parcial,
    // sí que netegem (els que sí han tornat ja no es poden tornar a desfer).
    const undoLastOperation = useCallback(async () => {
        if (undoStack.length === 0) return;
        const operation = undoStack[undoStack.length - 1];

        if (operation.type === 'delete' && Array.isArray(operation.ids)) {
            const results = await Promise.allSettled(
                operation.ids.map(id => axios.post(`/api/vault/pages/${id}/restore`))
            );
            const succeeded = [];
            const failed = [];
            results.forEach((r, i) => {
                if (r.status === 'fulfilled') succeeded.push(operation.ids[i]);
                else failed.push({ id: operation.ids[i], status: r.reason?.response?.status });
            });

            if (activeTableId) void fetchPagesByTable(activeTableId);
            else void fetchPages();

            if (succeeded.length > 0) {
                toast.success(`Restaurats ${succeeded.length} registre${succeeded.length !== 1 ? 's' : ''}`);
            }
            if (failed.length > 0) {
                const reasons = failed.map(f => f.status || '?').join(', ');
                toast.error(`No s'han pogut restaurar ${failed.length} registre${failed.length !== 1 ? 's' : ''} (codis: ${reasons})`);
            }

            if (succeeded.length === 0) {
                // Cap restauració: mantenim l'operació a undoStack per reintent.
                return;
            }
            // Si parcial, només els succeeded són candidats a "redo" — la
            // resta ja no es pot eliminar perquè potser ja ho està.
            setRedoStack(prev => [...prev, { type: 'delete', ids: succeeded }]);
        } else {
            setRedoStack(prev => [...prev, operation]);
        }

        setUndoStack(prev => prev.slice(0, -1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [undoStack, fetchPages, fetchPagesByTable, activeTableId]);

    // ---- REFER (Redo) — tornar a moure a la paperera ----
    const redoLastOperation = useCallback(async () => {
        if (redoStack.length === 0) return;
        const operation = redoStack[redoStack.length - 1];

        if (operation.type === 'delete' && Array.isArray(operation.ids)) {
            const results = await Promise.allSettled(
                operation.ids.map(id => axios.delete(`/api/vault/pages/${id}`))
            );
            const succeeded = [];
            const failed = [];
            results.forEach((r, i) => {
                const id = operation.ids[i];
                if (r.status === 'fulfilled' || r.reason?.response?.status === 404) {
                    succeeded.push(id);
                } else {
                    failed.push({ id, status: r.reason?.response?.status });
                }
            });

            if (succeeded.length > 0) {
                const nextPages = pages.filter(p => !succeeded.includes(p.id));
                syncPagesState(nextPages);
                succeeded.forEach(id => handleTabClose(id));
                toast.success(`Tornat a eliminar ${succeeded.length} registre${succeeded.length !== 1 ? 's' : ''}`);
            }
            if (failed.length > 0) {
                const reasons = failed.map(f => f.status || '?').join(', ');
                toast.error(`No s'han pogut tornar a eliminar ${failed.length} registre${failed.length !== 1 ? 's' : ''} (codis: ${reasons})`);
            }

            if (activeTableId) void fetchPagesByTable(activeTableId);
            else void fetchPages();

            if (succeeded.length === 0) return;

            setUndoStack(prev => [...prev, { type: 'delete', ids: succeeded }]);
        } else {
            setUndoStack(prev => [...prev, operation]);
        }

        setRedoStack(prev => prev.slice(0, -1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [redoStack, pages, syncPagesState, fetchPages, fetchPagesByTable, activeTableId, handleTabClose]);

    // Mantenir refs actualitzades (evita closures obsoletes al listener de Cmd+Z)
    useEffect(() => { undoRef.current = undoLastOperation; }, [undoLastOperation]);
    useEffect(() => { redoRef.current = redoLastOperation; }, [redoLastOperation]);

    const handleDuplicatePage = useCallback(async (pageId) => {
        try {
            const res = await axios.post(`/api/vault/pages/${pageId}/duplicate`);
            toast.success("Pàgina duplicada");
            await fetchPages();
            loadPage(res.data.id);
        } catch {
            toast.error("Error duplicant la pàgina");
        }
    }, [fetchPages, loadPage]);

    const handleRenamePage = useCallback(async (pageId, newTitle) => {
        try {
            const getRes = await axios.get(`/api/vault/pages/${pageId}`);
            const { content, metadata } = getRes.data;
            const updatedMeta = { ...metadata, title: newTitle };

            await axios.put(`/api/vault/pages/${pageId}`, {
                title: newTitle,
                content: content,
                is_database: updatedMeta.is_database || false,
                parent_id: updatedMeta.parent_id || null,
                metadata: updatedMeta
            });

            setTabs(prev => prev.map(t =>
                t.id === pageId ? { ...t, title: newTitle, metadata: updatedMeta } : t
            ));

            await fetchPages();
            // Refresca globalIndex perquè el títol nou aparegui al lookup
            // títol→id (els wikilinks `[[Antic títol]]` pendents quedaran
            // sense match però `[[Nou títol]]` resoldrà correctament; el
            // backend tampoc no fa "rewrite" automàtic dels wikilinks
            // existents, això requeriria un job separat).
            void fetchGlobalIndex();
            toast.success("Títol actualitzat");
        } catch {
            toast.error("Error renomenant la pàgina");
        }
    }, [fetchPages, setTabs]);

    const handleToggleFavorite = useCallback(async (pageId) => {
        if (!pageId) return;
        // Calcula el nou valor a partir de l'estat local (cau més ràpid que
        // un GET, i serveix també com a base per al patch optimista que fa
        // que la secció Favorits aparegui de seguida al sidebar sense
        // esperar al PUT + fetchPages següents).
        const currentPage = pagesRef.current.find(p => p.id === pageId)
            || tabs.find(t => t.id === pageId);
        const wasFav = currentPage?.metadata?.favorite === true
            || currentPage?.metadata?.favorite === 'true';
        const nextFav = !wasFav;

        // 1) Optimista: actualitza pages i tabs immediatament.
        setPages(prev => {
            const next = prev.map(p => p.id === pageId
                ? { ...p, metadata: { ...(p.metadata || {}), favorite: nextFav } }
                : p);
            pagesRef.current = next;
            return next;
        });
        setTabs(prevTabs => prevTabs.map(t => t.id === pageId
            ? { ...t, metadata: { ...(t.metadata || {}), favorite: nextFav } }
            : t));

        // 2) Persistència al backend. Necessitem el contingut actual per al
        // PUT (no perdre cos de la nota); si el GET o el PUT fallen,
        // revertim l'optimista per no enganyar l'usuari.
        try {
            const getRes = await axios.get(`/api/vault/pages/${pageId}`);
            const { content, metadata, title } = getRes.data;
            const updatedMeta = { ...metadata, favorite: nextFav };
            await axios.put(`/api/vault/pages/${pageId}`, {
                title: title,
                content: content,
                is_database: updatedMeta.is_database || false,
                parent_id: updatedMeta.parent_id || null,
                metadata: updatedMeta,
            });
            // No esperem a fetchPages (és lent en xarxes saturades); el
            // patch optimista ja ha refrescat la UI.
        } catch (err) {
            console.error(err);
            // Revertir optimista
            setPages(prev => {
                const next = prev.map(p => p.id === pageId
                    ? { ...p, metadata: { ...(p.metadata || {}), favorite: wasFav } }
                    : p);
                pagesRef.current = next;
                return next;
            });
            setTabs(prevTabs => prevTabs.map(tt => tt.id === pageId
                ? { ...tt, metadata: { ...(tt.metadata || {}), favorite: wasFav } }
                : tt));
            toast.error(t('errors.toggle_favorites'));
        }
    }, [tabs, t]);

    const handleEditSchema = useCallback((table, tabMetadata) => {
        const tid = table?.id || resolvePageTableId({ metadata: tabMetadata });
        if (!tid) {
            toast(t('common.wiki_no_table'));
            return;
        }
        setActiveTableId(tid);
        setIsSchemaModalOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [resolvePageTableId, setActiveTableId, setIsSchemaModalOpen]);

    // Persisteix una nova opció de `select`/`multi_select` al schema d'una
    // taula. Es crida quan l'usuari escriu un valor nou al picker del panell
    // de propietats. Sense això, el valor només queda al metadata del
    // registre (i acaba reapareixent com a "opció observada" via
    // getAvailableOptions) — sí funciona en visualització, però es perd la
    // intenció de tenir-la com a opció oficial del schema.
    const handleAddSchemaOption = useCallback(async (tableId, fieldId, nextOptions) => {
        if (!tableId || !fieldId || !Array.isArray(nextOptions)) return;
        try {
            await axios.patch(
                `/api/vault/tables/${tableId}/properties/${fieldId}`,
                { config: { options: nextOptions } }
            );
            await fetchRegistry();
        } catch (err) {
            notifyError('add-schema-option', err, t('errors.add_schema_option') || 'No s\'ha pogut desar l\'opció al schema');
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fetchRegistry, t]);

    // Filter all notes from all folders to find favorites?
    // For optimization, for now only those in the current folder if they have the 'favorite' tag.
    const favoritePages = pages.filter(p => (p.metadata?.favorite === true || p.metadata?.favorite === 'true') && !p.metadata?.is_template);

    // Recursive method to build breadcrumbs for parent->child hierarchy
    const buildPageParentBreadcrumbs = (pageId, currentTrail = []) => {
        const page = pages.find(p => p.id === pageId);
        if (!page) return currentTrail;
        const newTrail = [{ label: page.title, onClick: () => loadPage(page.id) }, ...currentTrail];
        if (page.parent_id) {
            return buildPageParentBreadcrumbs(page.parent_id, newTrail);
        }
        return newTrail;
    };

    const buildTableCrumbsByTableId = (tableId, viewId = null) => {
        const table = registry.tables?.find(t => t.id === tableId);
        if (!table) return [];

        const crumbs = [];
        const database = registry.databases?.find(db => db.id === table.database_id);
        if (database) {
            crumbs.push({
                label: database.name,
                onClick: () => handleTableSelect(table.id, viewId)
            });
        }

        crumbs.push({
            label: table.name,
            onClick: () => handleTableSelect(table.id, viewId)
        });

        return crumbs;
    };

    const buildTableContextBreadcrumbs = (page) => {
        if (!page) return [];
        const tableId = resolvePageTableId(page);
        if (!tableId) return [];
        return buildTableCrumbsByTableId(tableId);
    };

    // Construeix el tram "contenidor" del breadcrumb d'una entrada segons
    // l'ORIGEN real de navegació (d'on l'ha obert l'usuari), no només la
    // jerarquia estructural de la taula. Arbre de casos:
    //   - origen = dashboard   -> tram cap al dashboard (hi torna en clicar)
    //   - origen = vista taula  -> tram BD / Taula (a la vista exacta)
    //   - altres / desconegut   -> null (el cridador cau a la jerarquia estructural)
    const buildOriginContainerCrumbs = (origin) => {
        if (!origin) return null;
        if (origin.type === 'table') {
            const safeViewId = origin.subId && registry.views?.some(v => v.id === origin.subId)
                ? origin.subId
                : null;
            return buildTableCrumbsByTableId(origin.id, safeViewId);
        }
        if (origin.type === 'editor') {
            const originPage = pages.find(p => p.id === origin.id);
            if (!originPage) return null;
            const originIsDashboard = originPage.metadata?.is_dashboard === true
                || originPage.metadata?.is_dashboard === 'true';
            if (originIsDashboard) {
                return buildPageParentBreadcrumbs(origin.id);
            }
        }
        return null;
    };

    const breadcrumbs = [
        { label: 'Vault', onClick: () => { setActiveTabId(null); setViewMode('editor'); } }
    ];
    if (activeTabId) {
        const activePage = pages.find(p => p.id === activeTabId);
        const pageBreadcrumbs = buildPageParentBreadcrumbs(activeTabId);
        const hasParentHierarchy = pageBreadcrumbs.length > 1;

        if (!hasParentHierarchy) {
            // Per a un registre de taula, prioritza l'origen real de navegació
            // (dashboard o vista de taula) i, si no en tenim, cau a la
            // jerarquia estructural de la taula a què pertany el registre.
            let containerCrumbs = null;
            if (resolvePageTableId(activePage)) {
                const currentHistoryEntry = navigationHistory[historyPointer];
                const origin = (currentHistoryEntry && currentHistoryEntry.id === activeTabId)
                    ? currentHistoryEntry.from
                    : null;
                containerCrumbs = buildOriginContainerCrumbs(origin);
            }
            breadcrumbs.push(...(containerCrumbs ?? buildTableContextBreadcrumbs(activePage)));
        }

        breadcrumbs.push(...pageBreadcrumbs);
    }

    const currentOpenPage = activeTabId ? pages.find(p => p.id === activeTabId) : null;
    const currentActiveTab = activeTabId ? tabs.find(t => t.id === activeTabId) : null;
    const canToggleCodeView = viewMode === 'editor' && Boolean(currentActiveTab && !currentActiveTab.isTable && !currentActiveTab.isPdf);
    const isCodeViewActive = canToggleCodeView ? Boolean(codeViewByTabId[currentActiveTab.id]) : false;
    const quickOpenItems = React.useMemo(() => {
        const pageItems = pages
            .filter(p => !p.metadata?.is_template)
            .map(page => {
                const tableId = resolvePageTableId(page);
                const table = tableId ? registry.tables?.find(t => t.id === tableId) : null;
                const db = table ? registry.databases?.find(d => d.id === table.database_id) : null;
                const subtitle = table ? t('common.page_db', { db: db?.name || t('common.no_base'), table: table.name }) : t('common.page_wiki');
                return {
                    type: 'page',
                    id: page.id,
                    title: page.title || 'Sense títol',
                    subtitle
                };
            });

        const tableItems = (registry.tables || []).map(table => {
            const db = registry.databases?.find(d => d.id === table.database_id);
            return {
                type: 'table',
                id: table.id,
                title: table.name,
                subtitle: t('common.table_db', { db: db?.name || t('common.no_base') })
            };
        });

        const unique = new Map();
        [...tableItems, ...pageItems].forEach(item => {
            const key = `${item.type}-${item.id}`;
            if (!unique.has(key)) unique.set(key, item);
        });

        return Array.from(unique.values());
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pages, registry.tables, registry.databases, resolvePageTableId]);

    const openPaneEntries = [
        ...(activeTabId ? [{ type: tabs.find(t => t.id === activeTabId)?.isTable ? 'table' : 'page', id: activeTabId }] : []),
        ...splitTabIds
            .filter(tabId => tabId !== activeTabId && tabs.some(tab => tab.id === tabId))
            .map(tabId => ({ type: 'page', id: tabId })),
        ...splitTableIds
            .filter(tableId => tableId !== activeTableId)
            .map(tableId => ({ type: 'table', id: tableId }))
    ];

    // Relative size of each panel (% of total space). Initialized equally.
    const [paneSizes, setPaneSizes] = useState([]);
    const paneContainerRef = React.useRef(null);

    // Resynchronize sizes when the number of panels changes
    React.useEffect(() => {
        if (openPaneEntries.length === 0) { setPaneSizes([]); return; }
        setPaneSizes(prev => {
            if (prev.length === openPaneEntries.length) return prev;
            const equal = 100 / openPaneEntries.length;
            return openPaneEntries.map(() => equal);
        });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [openPaneEntries.length]);

    const handleDividerMouseDown = (dividerIndex, e) => {
        e.preventDefault();
        const container = paneContainerRef.current;
        if (!container) return;
        const containerWidth = container.getBoundingClientRect().width;
        const startX = e.clientX;
        const startSizes = [...paneSizes];

        const onMouseMove = (moveEvent) => {
            const delta = ((moveEvent.clientX - startX) / containerWidth) * 100;
            const newSizes = [...startSizes];
            const leftIdx = dividerIndex;
            const rightIdx = dividerIndex + 1;
            const newLeft = Math.max(10, startSizes[leftIdx] + delta);
            const newRight = Math.max(10, startSizes[rightIdx] - delta);
            const total = newLeft + newRight;
            newSizes[leftIdx] = (newLeft / total) * (startSizes[leftIdx] + startSizes[rightIdx]);
            newSizes[rightIdx] = (newRight / total) * (startSizes[leftIdx] + startSizes[rightIdx]);
            setPaneSizes(newSizes);
        };

        const onMouseUp = () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        };

        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    };

    const sidebar = (
        <VaultSidebar
            pages={pages}
            activePageId={activeTabId}
            favoritePages={favoritePages}
            isRegistryLoading={isRegistryLoading}
            onPageSelect={loadPage}
            onOpenParallel={handleOpenParallel}
            onCreatePage={(parentId) => handleOpenCreatePrompt(parentId, false)}
            onCreateDashboardPage={(parentId) => handleOpenCreatePrompt(parentId, false, false, true)}
            onSearch={() => setIsGlobalSearchOpen(true)}
            onOpenRecent={() => setIsRecentOpen(true)}
            onNavigate={(view) => {
                setViewMode(view);
                if (view !== 'editor') setActiveTabId(null);
            }}
            onDeletePage={handleDeletePage}
            onDuplicatePage={handleDuplicatePage}
            onRenamePage={handleRenamePage}
            onToggleFavorite={handleToggleFavorite}
            onMovePage={handleMovePage}
            currentView={viewMode}
            databases={registry.databases}
            tables={registry.tables}
            onTableSelect={(tableId, fromHistory = false) => {
                handleTableSelect(tableId, null, fromHistory);
            }}
            onOpenTable={(tableId) => handleOpenTableAsTab(tableId)}
            onOpenTableParallel={handleOpenTableParallel}
            onRenameDatabase={async (dbId, newName) => {
                try {
                    const db = registry.databases.find(d => d.id === dbId);
                    if (db) {
                        await axios.post('/api/vault/databases', { ...db, name: newName });
                        fetchRegistry();
                        toast.success(t('success.db_updated'));
                    }
                } catch {
                    toast.error(t('errors.rename_db'));
                }
            }}
            onDeleteDatabase={async (dbId) => {
                try {
                    await axios.delete(`/api/vault/databases/${dbId}`);
                    fetchRegistry();
                    if (activeTabId === dbId || activeTableId === dbId) {
                        setActiveTabId(null);
                        setActiveTableId(null);
                        setViewMode('editor');
                    }
                    handleTabClose(dbId);
                    toast.success(t('success.db_deleted'));
                } catch {
                    toast.error(t('errors.delete_db'));
                }
            }}
            onRenameTable={async (tableId, newName) => {
                try {
                    await axios.put(`/api/vault/tables/${tableId}`, { name: newName });
                    fetchRegistry();
                    toast.success(t('success.table_updated'));
                } catch {
                    toast.error(t('errors.rename_table'));
                }
            }}
            onDeleteTable={async (tableId) => {
                try {
                    await axios.delete(`/api/vault/tables/${tableId}`);
                    setSplitTableIds(prev => prev.filter(id => id !== tableId));
                    fetchRegistry();
                    if (activeTableId === tableId) {
                        setActiveTableId(null);
                        setViewMode('editor');
                    }
                    const tableTab = tabs.find(tab => tab.isTable && getTableIdFromTab(tab) === tableId);
                    if (tableTab) {
                        handleTabClose(tableTab.id);
                    }
                    toast.success(t('success.table_deleted'));
                } catch {
                    toast.error(t('errors.delete_table'));
                }
            }}
            onCreateDatabaseGroup={() => {
                setPromptModal({
                    isOpen: true,
                    defaultTitle: t('common.new_app'),
                    parentId: null,
                    isDatabase: false,
                    isApp: true,
                    isDrawing: false,
                    isView: false,
                    inputValue: t('common.new_app'),
                    isLoading: false
                });
            }}
            onCreateTable={(databaseId) => {
                setPromptModal({
                    isOpen: true,
                    defaultTitle: t('common.new_table'),
                    parentId: null,
                    isDatabase: true,
                    isDrawing: false,
                    isView: false,
                    inputValue: t('common.new_table'),
                    isLoading: false,
                    databaseId: databaseId // Meta to know which db it belongs to
                });
            }}
            onCreateTableRecord={(tableId) => handleCreateRecordForTable(tableId)}
            onCreateDrawing={() => handleOpenCreatePrompt(null, false, true)}
        />
    );

    const renderEditor = (tabId) => {
        const tab = tabs.find(t => t.id === tabId);
        if (!tab) return null;

        // Pestanyes PDF: visor integrat. No té contingut Markdown ni
        // metadades del Vault — només ruta del fitxer. Es comporta com
        // qualsevol pestanya (es pot tancar, reordenar, split-view).
        if (tab.isPdf) {
            return (
                <ZoteroReaderTab
                    key={tab.id}
                    src={tab.src}
                    title={tab.title}
                    kind={tab.kind || 'pdf'}
                    embedded
                />
            );
        }

        // If this is a table tab, render the table instead of the editor
        if (tab.isTable) {
            const tableId = getTableIdFromTab(tab);
            if (!tableId) return null;
            const table = registry.tables?.find(t => t.id === tableId);
            const paneNotes = getTableVisibleRecords(tableId);
            const paneTemplates = pages.filter(p => resolvePageTableId(p) === tableId && p.metadata?.is_template);
            const paneSchema = getSchemaFromTableId(tableId);
            
            // Get views for this specific table
            const displayViews = getTableViews(tableId);
            const currentViewId = activeTableId === tableId ? (activeViewId || displayViews[0].id) : displayViews[0].id;
            const cv = displayViews.find(v => v.id === currentViewId) || displayViews[0];

            return (
                <div className="h-full flex flex-col bg-white">
                    <VaultViewsHeader
                        tableName={table?.title || table?.name || t('common.table')}
                        recordCount={paneNotes.length}
                        views={displayViews}
                        activeViewId={currentViewId}
                        onViewSelect={(vid) => {
                            setActiveTableId(tableId);
                            setActiveViewId(vid);
                        }}
                        onAddView={handleAddView}
                        onEditView={handleConfigureView}
                        onDuplicateView={handleDuplicateView}
                        onDeleteView={handleDeleteView}
                        onReorderViews={handleReorderViews}
                        onRenameView={handleRenameView}
                        onEditSchema={(type) => {
                            setActiveTableId(tableId);
                            if (type === 'schema') setIsSchemaModalOpen(true);
                            else {
                                setViewToConfigure(cv);
                                setIsViewConfigOpen(true);
                                setViewConfigTab(type === 'filters' ? 'filters' : 'sort');
                            }
                        }}
                        onCreateRecord={(tplId) => handleAddNewNote(tableId, tplId)}
                        onCreateTemplate={() => {
                            setPromptModal({
                                isOpen: true,
                                defaultTitle: t('common.new_template'),
                                parentId: null,
                                isDatabase: false,
                                isDrawing: false,
                                isView: false,
                                isTemplate: true,
                                inputValue: t('common.new_template'),
                                isLoading: false
                            });
                        }}
                        searchTerm={searchTerm}
                        setSearchTerm={setSearchTerm}
                        templates={paneTemplates}
                    />
                    <div className="flex-1 overflow-hidden flex flex-col">
                        {(() => {
                            if (cv.type === 'board') {
                                return (
                                    <div className="p-0 h-full overflow-y-auto w-full custom-scrollbar bg-[var(--bg-primary)]">
                                        <VaultKanban
                                            notes={paneNotes}
                                            onNoteSelect={loadPage}
                                            isEmbedded={false}
                                            activeView={cv}
                                            onUpdateView={handleUpdateView}
                                            onDeletePage={handleDeletePage}
                                            onDeleteSelected={handleDeleteSelected}
                                            onEditSchema={(type) => {
                                                setActiveTableId(tableId);
                                                if (type === 'filters' || type === 'sorts') {
                                                    setViewToConfigure(cv);
                                                    setViewConfigTab(type);
                                                    setIsViewConfigOpen(true);
                                                } else {
                                                    setIsSchemaModalOpen(true);
                                                }
                                            }}
                                            searchTerm={searchTerm}
                                            onSearchChange={setSearchTerm}
                                        />
                                    </div>
                                );
                            }

                            if (cv.type === 'graph') {
                                return (
                                    <VaultGraph
                                        tableId={tableId}
                                        view={cv}
                                        searchTerm={searchTerm}
                                        isDarkMode={document.documentElement.classList.contains('dark')}
                                        onNodeClick={(nodeId) => loadPage(nodeId)}
                                    />
                                );
                            }

                            if (cv.type === 'gallery') {
                                return (
                                    <div className="p-0 h-full overflow-hidden w-full">
                                        <VaultGallery
                                            notes={paneNotes}
                                            onNoteSelect={loadPage}
                                            schema={paneSchema}
                                            idToTitle={globalIndex}
                                            allNotes={pages}
                                            activeView={cv}
                                            onUpdateView={handleUpdateView}
                                            onDeletePage={handleDeletePage}
                                            onDeleteSelected={handleDeleteSelected}
                                            onEditSchema={(type) => {
                                                setActiveTableId(tableId);
                                                if (type === 'filters' || type === 'sorts') {
                                                    setViewToConfigure(cv);
                                                    setViewConfigTab(type);
                                                    setIsViewConfigOpen(true);
                                                } else {
                                                    setIsSchemaModalOpen(true);
                                                }
                                            }}
                                            onCreateRecord={(tplId) => handleAddNewNote(tableId, tplId)}
                                            searchTerm={searchTerm}
                                            onSearchChange={setSearchTerm}
                                        />
                                    </div>
                                );
                            }

                            return (
                                <VaultTable
                                    notes={paneNotes}
                                    templates={paneTemplates}
                                    onNoteSelect={loadPage}
                                    schema={paneSchema}
                                    idToTitle={globalIndex}
                                    allNotes={pages}
                                    activeView={cv}
                                    onUpdateView={handleUpdateView}
                                    isListView={cv.type === 'list'}
                                    isEmbedded={false}
                                    onDeletePage={handleDeletePage}
                                    onDeleteSelected={handleDeleteSelected}
                                    onOpenParallel={handleOpenParallel}
                                    onUpdateFieldOptions={handleAddSchemaOption}
                                    onEditSchema={(type) => {
                                        setActiveTableId(tableId);
                                        if (type === 'filters' || type === 'sorts') {
                                            setViewToConfigure(cv);
                                            setViewConfigTab(type);
                                            setIsViewConfigOpen(true);
                                        } else {
                                            setIsSchemaModalOpen(true);
                                        }
                                    }}
                                    onCellSaved={async () => {
                                        await fetchPagesByTable(tableId);
                                    }}
                                    onCreateRecord={(templateId = null) => handleAddNewNote(tableId, templateId)}
                                    searchTerm={searchTerm}
                                    onSearchChange={setSearchTerm}
                                />
                            );
                        })()}
                    </div>
                </div>
            );
        }

        return (
            // key MUST be the page id so React unmounts the BlockEditor (and
            // resets all its refs and timers) when the user navigates to a
            // different note. Otherwise the spurious-autosave + unmount-save
            // logic in BlockEditor can fire a final PATCH against the wrong
            // note when reconciliation reuses the component instance.
            <BlockEditor
                key={tab.id}
                noteFilename={tab.id}
                initialContent={tab.content}
                initialMetadata={tab.metadata}
                isCodeView={Boolean(codeViewByTabId[tab.id])}
                onToggleCodeView={() => setCodeViewByTabId(prev => ({ ...prev, [tab.id]: !prev[tab.id] }))}
                isEditLocked={Boolean(editLockedByPageId[tab.id])}
                onUpdate={handleEditorUpdate}
                historyOpenSignal={tab.id === activeTabId ? historyOpenSignal : 0}
                folder="Universal"
                schema={schema}
                allNotes={pages}
                allTables={registry.tables}
                registry={registry}
                idToTitle={globalIndex}
                onRefreshIndex={fetchGlobalIndex}
                onRefreshNotes={fetchPages}
                onUpdatePageMetadata={updatePageMetadataLocal}
                onRefreshRegistry={fetchRegistry}
                onNoteSelect={loadPage}
                onOpenParallel={handleOpenParallel}
                onOpenPage={loadPage}
                onOpenInCurrentTab={handleOpenInCurrentTab}
                onOpenInNewTab={loadPage}
                onEditSchema={(table) => handleEditSchema(table, tab.metadata)}
                onAddSchemaOption={handleAddSchemaOption}
                onDeletePage={handleDeletePage}
                onCreateRecord={handleAddNewNote}
            />
        );
    };

    const renderTablePane = (tableId) => {
        const table = registry.tables?.find(t => t.id === tableId);
        const paneNotes = getTableVisibleRecords(tableId);
        const paneTemplates = pages.filter(p => resolvePageTableId(p) === tableId && p.metadata?.is_template);
        const paneSchema = getSchemaFromTableId(tableId);
        
        // Get views for this specific table
        const displayViews = getTableViews(tableId);
        const currentViewId = activeTableId === tableId ? (activeViewId || displayViews[0].id) : displayViews[0].id;
        const cv = displayViews.find(v => v.id === currentViewId) || displayViews[0];

        const handleCloseTablePane = () => {
            setSplitTableIds(prev => prev.filter(id => id !== tableId));
        };

        return (
            <div className="h-full flex flex-col bg-white border-l border-slate-200 shadow-xl overflow-hidden min-w-[350px]">
                <VaultViewsHeader
                    tableName={table?.title || table?.name || "Taula"}
                    recordCount={paneNotes.length}
                    views={displayViews}
                    activeViewId={currentViewId}
                    onViewSelect={(vid) => {
                        setActiveTableId(tableId);
                        setActiveViewId(vid);
                    }}
                    onAddView={handleAddView}
                    onEditView={handleConfigureView}
                    onDuplicateView={handleDuplicateView}
                    onDeleteView={handleDeleteView}
                    onReorderViews={handleReorderViews}
                    onRenameView={handleRenameView}
                    onConfigureFields={() => {
                        setActiveTableId(tableId);
                        setIsSchemaModalOpen(true);
                    }}
                    onEditSchema={(type) => {
                        setActiveTableId(tableId);
                        if (type === 'schema') setIsSchemaModalOpen(true);
                        else {
                            setViewToConfigure(cv);
                            setIsViewConfigOpen(true);
                            setViewConfigTab(type === 'filters' ? 'filters' : 'sort');
                        }
                    }}
                    onCreateRecord={(tplId) => handleAddNewNote(tableId, tplId)}
                    onCreateTemplate={() => handleAddView('template')}
                    searchTerm={searchTerm}
                    setSearchTerm={setSearchTerm}
                    templates={paneTemplates}
                    onClose={handleCloseTablePane}
                />
                <div className="flex-1 overflow-hidden flex flex-col">
                    {(() => {
                        if (cv.type === 'board') {
                            return (
                                <div className="p-0 h-full overflow-y-auto w-full custom-scrollbar bg-[var(--bg-primary)]">
                                    <VaultKanban
                                        notes={paneNotes}
                                        onNoteSelect={loadPage}
                                        isEmbedded={true}
                                        activeView={cv}
                                        onUpdateView={handleUpdateView}
                                        onDeletePage={handleDeletePage}
                                        onDeleteSelected={handleDeleteSelected}
                                        onEditSchema={(type) => {
                                            setActiveTableId(tableId);
                                            if (type === 'filters' || type === 'sorts') {
                                                setViewToConfigure(cv);
                                                setViewConfigTab(type);
                                                setIsViewConfigOpen(true);
                                            } else {
                                                setIsSchemaModalOpen(true);
                                            }
                                        }}
                                        searchTerm={searchTerm}
                                        onSearchChange={setSearchTerm}
                                    />
                                </div>
                            );
                        }

                        if (cv.type === 'graph') {
                        return (
                            <VaultGraph
                                tableId={tableId}
                                view={cv}
                                searchTerm={searchTerm}
                                isDarkMode={document.documentElement.classList.contains('dark')}
                                onNodeClick={(nodeId) => loadPage(nodeId)}
                            />
                        );
                    }

                    if (cv.type === 'gallery') {
                            return (
                                <div className="p-0 h-full overflow-hidden w-full">
                                    <VaultGallery
                                        notes={paneNotes}
                                        onNoteSelect={loadPage}
                                        schema={paneSchema}
                                        idToTitle={globalIndex}
                                        allNotes={pages}
                                        activeView={cv}
                                        onUpdateView={handleUpdateView}
                                        onDeletePage={handleDeletePage}
                                        onDeleteSelected={handleDeleteSelected}
                                        onEditSchema={(type) => {
                                            setActiveTableId(tableId);
                                            if (type === 'filters' || type === 'sorts') {
                                                setViewToConfigure(cv);
                                                setViewConfigTab(type);
                                                setIsViewConfigOpen(true);
                                            } else {
                                                setIsSchemaModalOpen(true);
                                            }
                                        }}
                                        onCreateRecord={(tplId) => handleAddNewNote(tableId, tplId)}
                                        onCreateTemplate={() => {
                                            setPromptModal({
                                                isOpen: true,
                                                defaultTitle: t('common.new_template'),
                                                parentId: null,
                                                isDatabase: false,
                                                isDrawing: false,
                                                isView: false,
                                                isTemplate: true,
                                                inputValue: t('common.new_template'),
                                                isLoading: false
                                            });
                                        }}
                                        searchTerm={searchTerm}
                                        onSearchChange={setSearchTerm}
                                    />
                                </div>
                            );
                        }

                        return (
                            <VaultTable
                                notes={paneNotes}
                                templates={paneTemplates}
                                onNoteSelect={loadPage}
                                schema={paneSchema}
                                idToTitle={globalIndex}
                                allNotes={pages}
                                activeView={cv}
                                onUpdateView={handleUpdateView}
                                isListView={cv.type === 'list'}
                                isEmbedded={true}
                                onDeletePage={handleDeletePage}
                                onDeleteSelected={handleDeleteSelected}
                                onOpenParallel={handleOpenParallel}
                                onUpdateFieldOptions={handleAddSchemaOption}
                                onEditSchema={(type) => {
                                    setActiveTableId(tableId);
                                    if (type === 'filters' || type === 'sorts') {
                                        setViewToConfigure(cv);
                                        setViewConfigTab(type);
                                        setIsViewConfigOpen(true);
                                    } else {
                                        setIsSchemaModalOpen(true);
                                    }
                                }}
                                onCellSaved={async () => {
                                    await fetchPagesByTable(tableId);
                                }}
                                onCreateRecord={(templateId) => handleAddNewNote(tableId, templateId)}
                                searchTerm={searchTerm}
                                onSearchChange={setSearchTerm}
                            />
                        );
                    })()}
                </div>
            </div>
        );
    };

    const activeTable = registry.tables?.find(t => t.id === activeTableId);

    return (
        <VaultShell
            sidebarContent={sidebar}
            breadcrumbs={breadcrumbs}
            isFavorite={tabs.find(t => t.id === activeTabId)?.metadata?.favorite === true}
            onToggleFavorite={() => handleToggleFavorite(activeTabId)
            }
            onSearch={() => setIsGlobalSearchOpen(true)}
            onBack={handleNavigationBack}
            onForward={handleNavigationForward}
            canGoBack={historyPointer > 0}
            canGoForward={historyPointer < navigationHistory.length - 1}
            canOpenHistory={Boolean(currentOpenPage)}
            onOpenHistory={() => {
                if (!currentOpenPage) return;
                setHistoryOpenSignal(prev => prev + 1);
            }}
            canDeleteCurrentPage={Boolean(currentOpenPage)}
            onDeleteCurrentPage={() => {
                if (!currentOpenPage) return;
                handleDeletePage(currentOpenPage.id, currentOpenPage.title || 'Sense títol');
            }}
            canToggleCodeView={canToggleCodeView}
            isCodeView={isCodeViewActive}
            onToggleCodeView={() => {
                if (!canToggleCodeView || !currentActiveTab?.id) return;
                setCodeViewByTabId(prev => ({
                    ...prev,
                    [currentActiveTab.id]: !prev[currentActiveTab.id],
                }));
            }}
            canToggleEditLock={Boolean(currentActiveTab?.id) && viewMode === 'editor' && !currentActiveTab.isPdf}
            isEditLocked={Boolean(currentActiveTab?.id && editLockedByPageId[currentActiveTab.id])}
            onToggleEditLock={() => {
                if (!currentActiveTab?.id) return;
                setEditLockedByPageId(prev => {
                    const next = { ...prev };
                    if (next[currentActiveTab.id]) {
                        delete next[currentActiveTab.id];
                    } else {
                        next[currentActiveTab.id] = true;
                    }
                    return next;
                });
            }}
        >
            <div className="h-full bg-[var(--bg-primary)] flex flex-col min-w-0">
                {(viewMode === 'editor' || viewMode === 'drawing') && (
                    <VaultDocumentTabs
                        tabs={tabs}
                        activeTabId={activeTabId}
                        splitTabIds={splitTabIds}
                        onTabSelect={handleTabSelect}
                        onTabClose={handleTabClose}
                        onToggleSplit={handleToggleSplit}
                        quickOpenItems={quickOpenItems}
                        onQuickOpenItem={(item) => {
                            if (item.type === 'table') {
                                handleOpenTableAsTab(item.id);
                                return;
                            }
                            loadPage(item.id);
                        }}
                        onQuickOpenParallel={(item) => {
                            if (item.type === 'table') {
                                handleOpenTableParallel(item.id);
                                return;
                            }
                            if (item.type === 'page') {
                                handleOpenParallel(item.id);
                            }
                        }}
                        onReorderTabs={(reordered) => setTabs(reordered)}
                    />
                )}

                <div className="flex-1 flex overflow-hidden min-w-0" ref={paneContainerRef}>
                    {viewMode === 'editor' && activeTabId ? (
                        <>
                            {openPaneEntries.map((pane, index) => (
                                <React.Fragment key={`${pane.type}-${pane.id}-${index === 0 ? 'primary' : 'split'}`}>
                                    <div
                                        className={`flex flex-col overflow-hidden min-w-0 ${index > 0 ? 'bg-[var(--bg-secondary)]' : ''}`}
                                        style={{ width: paneSizes[index] != null ? `${paneSizes[index]}%` : `${100 / openPaneEntries.length}%`, flexShrink: 0 }}
                                    >
                                        <div className="flex-1 overflow-y-auto w-full min-w-0 h-full">
                                            {pane.type === 'table' && tabs.find(tab => tab.id === pane.id)?.isTable
                                                ? renderEditor(pane.id)
                                                : pane.type === 'table'
                                                    ? renderTablePane(pane.id)
                                                    : renderEditor(pane.id)}
                                        </div>
                                    </div>
                                    {index < openPaneEntries.length - 1 && (
                                        <div
                                            className="w-1 shrink-0 bg-[var(--border-primary)] hover:bg-indigo-300 cursor-col-resize transition-colors active:bg-indigo-400 z-10 select-none"
                                            onMouseDown={(e) => handleDividerMouseDown(index, e)}
                                            title={t('common.drag_resize')}
                                        />
                                    )}
                                </React.Fragment>
                            ))}
                        </>
                    ) : viewMode === 'drawing' ? (
                        <div className="flex-1 flex flex-col overflow-hidden min-w-0 bg-[var(--bg-primary)]">
                            {activeTabId ? (
                                <TldrawEditor
                                    drawingId={activeTabId}
                                    title={tabs.find(t => t.id === activeTabId)?.title}
                                    onClose={() => {
                                        handleTabClose(activeTabId);
                                        setViewMode('editor');
                                    }}
                                    onSaveSuccess={() => { }}
                                />
                            ) : (
                                <VaultDrawings
                                    onDrawingSelect={(id, title) => {
                                        if (!tabs.find(t => t.id === id)) {
                                            setTabs(prev => [...prev, { id, title: title, isDrawing: true }]);
                                        }
                                        setActiveTabId(id);
                                    }}
                                />
                            )}
                        </div>
                    ) : viewMode === 'trash' ? (
                        <div className="flex-1 flex flex-col overflow-hidden min-w-0 bg-[var(--bg-primary)]">
                            <VaultTrashView
                                onAfterChange={() => {
                                    if (activeTableId) void fetchPagesByTable(activeTableId);
                                    else void fetchPages();
                                }}
                            />
                        </div>
                    ) : viewMode === 'table' && activeTableId ? (
                        <div className="flex-1 flex flex-col overflow-hidden min-w-0 bg-[var(--bg-primary)]">
                            {(() => {
                                const displayViews = getTableViews(activeTableId);

                                return (
                                    <VaultViewsHeader
                                        tableName={activeTable ? (activeTable.title || activeTable.name) : t('common.table')}
                                        recordCount={(tableNotes || []).length}
                                        views={displayViews}
                                        activeViewId={activeViewId || 'default'}
                                        onViewSelect={setActiveViewId}
                                        onAddView={handleAddView}
                                        onEditView={handleConfigureView}
                                        onDuplicateView={handleDuplicateView}
                                        onDeleteView={handleDeleteView}
                                        onReorderViews={handleReorderViews}
                                        onRenameView={handleRenameView}
                                        onConfigureFields={() => setIsSchemaModalOpen(true)}
                                        onEditSchema={(type) => {
                                            if (type === 'schema') setIsSchemaModalOpen(true);
                                            else {
                                                const currentView = displayViews.find(v => v.id === activeViewId) || displayViews[0];
                                                setViewToConfigure(currentView);
                                                setIsViewConfigOpen(true);
                                                setViewConfigTab(type === 'filters' ? 'filters' : 'sort');
                                            }
                                        }}
                                        onCreateRecord={(tplId) => handleAddNewNote(activeTableId, tplId)}
                                        onCreateTemplate={() => handleAddView('template')}
                                        searchTerm={searchTerm}
                                        setSearchTerm={setSearchTerm}
                                        templates={tableTemplates}
                                    />
                                );
                            })()}

                            <div className="flex-1 overflow-hidden">
                                {(() => {
                                    const displayViews = getTableViews(activeTableId);
                                    const cv = displayViews.find(v => v.id === activeViewId) || displayViews[0] || { id: 'default', name: MAIN_VIEW_NAME, type: 'table', sort: { field: 'last_modified', direction: 'desc' }, is_main: true };

                                    if (cv.type === 'board') {
                                        return (
                                            <div className="p-0 h-full overflow-y-auto w-full custom-scrollbar bg-[var(--bg-secondary)]">
                                                <VaultKanban
                                                    notes={tableNotes}
                                                    onNoteSelect={loadPage}
                                                    isEmbedded={false}
                                                    activeView={cv}
                                                    onUpdateView={handleUpdateView}
                                                    onDeletePage={handleDeletePage}
                                                    onDeleteSelected={handleDeleteSelected}
                                                    onEditSchema={(type) => {
                                                        if (type === 'filters' || type === 'sorts') {
                                                            setViewToConfigure(cv);
                                                            setViewConfigTab(type);
                                                            setIsViewConfigOpen(true);
                                                        } else {
                                                            setIsSchemaModalOpen(true);
                                                        }
                                                    }}
                                                    searchTerm={searchTerm}
                                                    onSearchChange={setSearchTerm}
                                                />
                                            </div>
                                        );
                                    }

                                    if (cv.type === 'calendar') {
                                        return (
                                            <div className="p-6 h-full">
                                                <DigitalBrainCalendar
                                                    allNotes={tableNotes}
                                                    onNoteSelect={loadPage}
                                                    onDeletePage={handleDeletePage}
                                                    onDeleteSelected={handleDeleteSelected}
                                                />
                                            </div>
                                        );
                                    }

                                    if (cv.type === 'gallery') {
                                        return (
                                            <div className="p-0 h-full overflow-hidden w-full">
                                                <VaultGallery
                                                    notes={tableNotes}
                                                    onNoteSelect={loadPage}
                                                    schema={schema}
                                                    idToTitle={globalIndex}
                                                    allNotes={pages}
                                                    activeView={cv}
                                                    onUpdateView={handleUpdateView}
                                                    onDeletePage={handleDeletePage}
                                                    onDeleteSelected={handleDeleteSelected}
                                                    onEditSchema={(type) => {
                                                        if (type === 'filters' || type === 'sorts') {
                                                            setViewToConfigure(cv);
                                                            setViewConfigTab(type);
                                                            setIsViewConfigOpen(true);
                                                        } else {
                                                            setIsSchemaModalOpen(true);
                                                        }
                                                    }}
                                                    onCreateRecord={(tplId) => handleAddNewNote(activeTableId, tplId)}
                                                    searchTerm={searchTerm}
                                                    onSearchChange={setSearchTerm}
                                                />
                                            </div>
                                        );
                                    }

                                    if (cv.type === 'timeline') {
                                        return (
                                            <div className="p-0 h-full overflow-hidden w-full bg-[var(--bg-secondary)]">
                                                <VaultTimeline
                                                    notes={tableNotes}
                                                    onNoteSelect={loadPage}
                                                    onUpdateNote={handleUpdateNote}
                                                    schema={schema}
                                                    idToTitle={globalIndex}
                                                    activeView={cv}
                                                    onUpdateView={handleUpdateView}
                                                    onDeletePage={handleDeletePage}
                                                    onDeleteSelected={handleDeleteSelected}
                                                    onEditSchema={(type) => {
                                                        if (type === 'filters' || type === 'sorts') {
                                                            setViewToConfigure(cv);
                                                            setViewConfigTab(type);
                                                            setIsViewConfigOpen(true);
                                                        } else {
                                                            setIsSchemaModalOpen(true);
                                                        }
                                                    }}
                                                    searchTerm={searchTerm}
                                                    onSearchChange={setSearchTerm}
                                                />
                                            </div>
                                        );
                                    }

                                    if (cv.type === 'feed') {
                                        return (
                                            <div className="p-0 h-full overflow-y-auto w-full custom-scrollbar bg-[var(--bg-secondary)]">
                                                <VaultFeed
                                                    notes={tableNotes}
                                                    onNoteSelect={loadPage}
                                                    schema={schema}
                                                    idToTitle={globalIndex}
                                                    allNotes={pages}
                                                    onDeletePage={handleDeletePage}
                                                    onDeleteSelected={handleDeleteSelected}
                                                    searchTerm={searchTerm}
                                                    onSearchChange={setSearchTerm}
                                                />
                                            </div>
                                        );
                                    }

                                    // Table or list
                                    return (
                                        <VaultTable
                                            notes={tableNotes}
                                            templates={tableTemplates}
                                            onNoteSelect={loadPage}
                                            schema={schema}
                                            idToTitle={globalIndex}
                                            allNotes={pages}
                                            activeView={cv}
                                            onUpdateView={handleUpdateView}
                                            isListView={cv.type === 'list'}
                                            onDeletePage={handleDeletePage}
                                            onDeleteSelected={handleDeleteSelected}
                                            onOpenParallel={handleOpenParallel}
                                            onUpdateFieldOptions={handleAddSchemaOption}
                                            onEditSchema={(type) => {
                                                if (type === 'filters' || type === 'sorts') {
                                                    setViewToConfigure(cv);
                                                    setViewConfigTab(type);
                                                    setIsViewConfigOpen(true);
                                                } else {
                                                    setIsSchemaModalOpen(true);
                                                }
                                            }}
                                            onCellSaved={async () => {
                                                if (activeTableId) {
                                                    await fetchPagesByTable(activeTableId);
                                                } else {
                                                    await fetchPages();
                                                }
                                            }}
                                            onCreateTemplate={() => {
                                                setPromptModal({
                                                    isOpen: true,
                                                    defaultTitle: t('common.new_template'),
                                                    parentId: null,
                                                    isDatabase: false,
                                                    isDrawing: false,
                                                    isView: false,
                                                    isTemplate: true,
                                                    inputValue: t('common.new_template'),
                                                    isLoading: false
                                                });
                                            }}
                                            onDuplicateTemplate={handleDuplicateTemplate}
                                            onSetDefaultTemplate={handleSetDefaultTemplate}
                                            onCreateRecord={(templateId) => handleAddNewNote(activeTableId, templateId)}
                                            searchTerm={searchTerm}
                                            onSearchChange={setSearchTerm}
                                        />
                                    );
                                })()}
                            </div>
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center w-full h-[80vh] text-[var(--text-tertiary)] px-4">
                            <FileText size={64} className="mb-4 text-[var(--bg-tertiary)]" strokeWidth={1} />
                            <h2 className="text-xl font-medium text-[var(--text-secondary)]">{t('vault_welcome_title', 'Benvinguda')}</h2>
                            <p className="mt-2 max-w-md text-center">{t('vault_welcome_subtitle', 'Selecciona una pàgina del vault o')}</p>
                            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                                <button
                                    onClick={() => handleOpenCreatePrompt(null, false)}
                                    className="btn btn-gnosi-primary"
                                >
                                    {t('vault_welcome_create_page', 'Crea una pàgina')}
                                </button>
                                <button
                                    onClick={() => handleOpenCreatePrompt(null, true)}
                                    className="btn btn-gnosi-primary"
                                >
                                    {t('vault_welcome_create_db', 'Crea una BD')}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <GlobalSearchModal
                isOpen={isGlobalSearchOpen}
                onClose={() => setIsGlobalSearchOpen(false)}
                allNotes={pages}
                onNoteSelect={loadPage}
            />

            <RecentModal
                isOpen={isRecentOpen}
                onClose={() => setIsRecentOpen(false)}
                allNotes={pages}
                onNoteSelect={loadPage}
            />

            {
                viewToDelete && (
                    <ConfirmModal
                        isOpen={!!viewToDelete}
                        onClose={() => setViewToDelete(null)}
                        onConfirm={executeDeleteView}
                        title={t('common.confirm_delete_view')}
                        message={t('common.confirm_delete_view_msg', { name: viewToDelete.name })}
                        confirmText={t('common.delete')}
                        isDestructive={true}
                    />
                )
            }

            {
                promptModal.isOpen && (
                    <div
                        className="fixed inset-0 bg-black/60 backdrop-blur-[2px] z-[100] flex items-center justify-center p-4"
                    >
                        <form
                            onSubmit={executeCreateContent}
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => {
                                if (e.key === 'Escape') {
                                                closePromptModal();
                                }
                            }}
                            className="bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg shadow-xl w-full max-w-md p-6 animate-in zoom-in-95 duration-200"
                        >
                            <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4">
                                {promptModal.isRename ? t('common.rename_view', { name: promptModal.targetView?.name }) :
                                    (promptModal.isView ? t('common.new_view') :
                                        (promptModal.isDrawing ? t('common.new_drawing') :
                                            (promptModal.isDashboard ? t('common.new_dashboard') :
                                            (promptModal.isDatabase && promptModal.databaseId ? t('common.new_table') :
                                                (promptModal.isApp ? t('common.new_app') :
                                                    (promptModal.isTemplate ? t('common.save_as_template') : t('common.new_page')))))))}
                            </h3>
                            <div className="mb-6">
                                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
                                    {promptModal.isRename ? t('common.prompt_new_name') : t('common.prompt_name')}
                                </label>
                                    <input
                                        autoFocus
                                        type="text"
                                        value={promptModal.inputValue}
                                        onChange={(e) => setPromptModal(prev => ({ ...prev, inputValue: e.target.value }))}
                                        className="w-full bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-md px-3 py-2 text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-gnosi focus:border-gnosi"
                                        placeholder={promptModal.defaultTitle}
                                        disabled={promptModal.isLoading}
                                        onFocus={(e) => e.target.select()}
                                    />
                            </div>
                            <div className="flex justify-end gap-3 w-full">
                                <button
                                    type="button"
                                    onClick={closePromptModal}
                                    className="px-4 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] rounded-md transition-colors"
                                    disabled={promptModal.isLoading}
                                >
                                    {t('common.cancel')}
                                </button>
                                <button
                                    type="submit"
                                    disabled={promptModal.isLoading || !promptModal.inputValue.trim()}
                                    className="btn btn-gnosi-primary px-4 py-2 text-sm font-medium disabled:opacity-50 flex items-center gap-2"
                                >
                                    {promptModal.isLoading && <Loader2 size={16} className="animate-spin" />}
                                    {promptModal.isRename ? t('common.rename') : t('common.create')}
                                </button>
                            </div>
                        </form>
                    </div>
                )
            }

            {
                isSchemaModalOpen && activeTableId && (() => {
                    const activeTable = registry.tables?.find(t => t.id === activeTableId);
                    const cv = getTableViews(activeTableId).find(v => v.id === activeViewId) || { id: 'default', table_id: activeTableId, name: MAIN_VIEW_NAME, type: 'table', is_main: true };
                    const currentSchemaObj = getSchemaFromTableId(activeTableId);
                    return (
                        <SchemaConfigModal
                            isOpen={true}
                            onClose={() => setIsSchemaModalOpen(false)}
                            folder={activeTable?.name || t('common.table')}
                            currentSchema={currentSchemaObj}
                            initialEnableSubitems={cv?.enableSubitems}
                            initialEnableTranslation={!!activeTable?.translation_enabled}
                            initialVisibleProperties={cv?.is_main ? getSchemaFieldNames(currentSchemaObj) : cv?.visibleProperties}
                            onSchemaUpdated={(newSchema) => setSchema(newSchema)}
                            onSave={async (newSchemaObj, viewConfig) => {
                                const newProperties = buildTablePropertiesFromSchema(newSchemaObj);
                                try {
                                    // 1. Update table schema (Backend registry).
                                    // `translation_enabled` és metadada de la taula
                                    // (no de la vista) perquè defineix què es pot
                                    // traduir, no com es mostra.
                                    await axios.post(`/api/vault/tables`, {
                                        ...activeTable,
                                        properties: newProperties,
                                        translation_enabled: !!viewConfig.enableTranslation
                                    });
                                    setSchema(newSchemaObj);

                                    // 2. Update view configuration if it exists
                                    if (cv?.id) {
                                        await handleUpdateView({
                                            ...cv,
                                            enableSubitems: viewConfig.enableSubitems,
                                            visibleProperties: cv?.is_main ? getSchemaFieldNames(newSchemaObj) : viewConfig.visibleProperties
                                        });
                                    }

                                    await fetchRegistry();
                                    // No tanquem el modal ni mostrem toast: el modal
                                    // fa autosave continu — tancar-lo a cada save
                                    // l'expulsava al primer canvi de l'usuari.
                                } catch (err) {
                                    console.error("Error saving structure:", err);
                                    toast.error(t('errors.save_config'));
                                }
                            }}
                        />
                    );
                })()
            }
            {
                isViewConfigOpen && viewToConfigure && (
                    <ViewConfigModal
                        isOpen={isViewConfigOpen}
                        onClose={() => { setIsViewConfigOpen(false); setViewToConfigure(null); setPendingView(null); }}
                        schema={schema}
                        initialVisibleProperties={viewToConfigure.visibleProperties}
                        viewType={viewToConfigure.type}
                        initialCardSize={viewToConfigure.cardSize}
                        initialGalleryPreview={viewToConfigure.galleryPreview}
                        initialFilters={viewToConfigure.filters}
                        initialSorts={viewToConfigure.sort}
                        initialTab={viewConfigTab}
                        onSave={async (config) => {
                            // Autosave continu: no tanquem el modal a cada
                            // canvi. L'usuari el tanca amb X o Esc quan vol.
                            await handleSaveViewConfig(config);
                        }}
                    />
                )
            }
        </VaultShell >
    );
}
