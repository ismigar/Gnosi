import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import axios from 'axios';
import { toast } from 'react-hot-toast';
import { v4 as uuidv4 } from 'uuid';
import { FileText, Loader2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { NotionShell } from '../components/Vault/NotionShell';
import { VaultSidebar } from '../components/Vault/VaultSidebar';
import { VaultTabs } from '../components/Vault/VaultTabs';
import { VaultTable } from '../components/Vault/VaultTable';
import { VaultKanban } from '../components/Vault/VaultKanban';
import { BlockEditor, inFlightSaves } from '../components/Vault/BlockEditor';
import { SchemaConfigModal } from '../components/Vault/SchemaConfigModal';
import { ViewConfigModal } from '../components/Vault/ViewConfigModal';
import { GlobalSearchModal } from '../components/Vault/GlobalSearchModal';
import { RecentModal } from '../components/Vault/RecentModal';
import { DigitalBrainCalendar } from '../components/Vault/DigitalBrainCalendar';
import { VaultGallery } from '../components/Vault/VaultGallery';
import { VaultTimeline } from '../components/Vault/VaultTimeline';
import { VaultFeed } from '../components/Vault/VaultFeed';
import { VaultDocumentTabs } from '../components/Vault/VaultDocumentTabs';
import { VaultViewsHeader } from '../components/Vault/VaultViewsHeader';
import VaultDrawings from '../components/Vault/VaultDrawings';
import { VaultGraph } from '../components/Vault/VaultGraph';
import { MAIN_VIEW_NAME, isMainView } from '../components/Vault/viewConstants';
import { buildSchemaFromTableProperties, buildTablePropertiesFromSchema, getSchemaFieldNames } from '../components/Vault/schemaUtils';
import { applyDefaultFormulasToMetadata } from '../components/Vault/defaultFormulaUtils';
import { Palette } from 'lucide-react';
import ConfirmModal from '../components/ConfirmModal';
import TldrawEditor from '../components/Vault/TldrawEditor';

export default function VaultDashboard() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const location = useLocation();
    const { "*": nestedPath } = useParams();

    const [pages, setPages] = useState([]);
    const [tabs, setTabs] = useState([]);
    const [activeTabId, setActiveTabId] = useState(null);
    const [codeViewByTabId, setCodeViewByTabId] = useState({});
    const [splitTabIds, setSplitTabIds] = useState([]);
    const [splitTableIds, setSplitTableIds] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isRegistryLoading, setIsRegistryLoading] = useState(true);
    const [pageToDelete, setPageToDelete] = useState(null);
    const [recordsToDelete, setRecordsToDelete] = useState(null); // Estat per confirmar eliminació múltiple
    const [viewToDelete, setViewToDelete] = useState(null);
    const [promptModal, setPromptModal] = useState({ isOpen: false, defaultTitle: '', parentId: null, isDatabase: false, isDrawing: false, isDashworks: false, isView: false, isRename: false, targetView: null, viewType: null, inputValue: '', isLoading: false });

    // De moment suportem "editor" per totes les pàgines. 
    // Podeu afegir "table" directament aquí o mitjançant custom blocks.
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
    const [tableCountsById, setTableCountsById] = useState({});
    const [isSchemaModalOpen, setIsSchemaModalOpen] = useState(false);
    const [isViewConfigOpen, setIsViewConfigOpen] = useState(false);
    const [viewToConfigure, setViewToConfigure] = useState(null);
    const [viewConfigTab, setViewConfigTab] = useState('appearance');
    const [pendingView, setPendingView] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const pageRequestInFlightRef = useRef(new Map());


    // --- Historial de Navegació Personalitzat ---
    const [navigationHistory, setNavigationHistory] = useState([]);
    const [historyPointer, setHistoryPointer] = useState(-1);
    const [isInternalNavigating, setIsInternalNavigating] = useState(false);

    // --- Historial d'accions (Undo/Redo) ---
    const [undoStack, setUndoStack] = useState([]);
    const [redoStack, setRedoStack] = useState([]);
    const undoRef = useRef(null);
    const redoRef = useRef(null);
    const TABLE_TAB_PREFIX = 'table:';

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

    const fetchPageById = useCallback(async (pageId, maxAbortRetries = 1) => {
        if (!pageId) return null;

        const existingRequest = pageRequestInFlightRef.current.get(pageId);
        if (existingRequest) {
            return existingRequest;
        }

        const requestPromise = (async () => {
            let lastErr = null;
            for (let attempt = 0; attempt <= maxAbortRetries; attempt += 1) {
                try {
                    const res = await axios.get(`/api/vault/pages/${pageId}`);
                    return res;
                } catch (err) {
                    lastErr = err;
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
                console.log(`[VaultDashboard] Using in-flight save for ${pageId}`);
                return {
                    data: {
                        id: pageId,
                        title: inFlight.metadata?.title || "Sense títol",
                        content: inFlight.content,
                        metadata: inFlight.metadata,
                        last_modified: new Date(inFlight.timestamp).toISOString()
                    }
                };
            }

            return await requestPromise;
        } finally {
            pageRequestInFlightRef.current.delete(pageId);
        }
    }, [isAbortLikeError]);

    console.log("VaultDashboard Render:", { viewMode, activeTabId, activeTableId, tabsCount: tabs.length });

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

        // Navegació de React Router (Sincronització de URL)
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
            // Evitar duplicats consecutius del mateix ID i tipus
            if (next.length > 0 && next[next.length - 1].id === entry.id && next[next.length - 1].type === entry.type && next[next.length - 1].subId === entry.subId) {
                return next;
            }
            return [...next, { ...entry }];
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
            isDashworks: false,
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
        
        // Cerca recursiva cap amunt per context de taula (per subcarpetes a BD/)
        if (page.parent_id && currentPages?.length > 0) {
            const parent = currentPages.find(p => p.id === page.parent_id);
            if (parent && parent.id !== page.id) return resolvePageTableId(parent, currentPages);
        }
        
        return null;
    }, [pages]);

    const shouldIncludeTableRecord = useCallback((page, tableId, currentPages = pages) => {
        if (!page || resolvePageTableId(page, currentPages) !== tableId) return false;
        if (page.metadata?.is_template) return false;

        // Recursos també conté anotacions tècniques/importades que no són registres principals.
        if (tableId === 'resources') {
            const tipus = String(page.metadata?.Tipus || '').trim().toLowerCase();
            const title = String(page.title || '').trim().toLowerCase();
            const gnosiId = String(page.metadata?.id || page.id || '').trim();
            if (tipus === 'annotation') return false;
            if (title === 'nou' || title === 'sense títol' || title === 'sense titol') return false;
            if (!gnosiId) return false;
        }

        return true;
    }, [resolvePageTableId, pages]);

    const getVisibleTableRecords = useCallback((records, tableId, currentPages = pages) => {
        const filtered = (records || []).filter(page => shouldIncludeTableRecord(page, tableId, currentPages));
        if (tableId !== 'resources') return filtered;


        // Alguns recursos arriben duplicats amb variants de puntuacio/accents al titol.
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
    }, [shouldIncludeTableRecord]);

    const getTableVisibleRecords = useCallback((tableId) => {
        if (!tableId) return [];
        return visibleTableRecordsById[tableId] || getVisibleTableRecords(pages, tableId);
    }, [getVisibleTableRecords, pages, visibleTableRecordsById]);

    const syncPagesState = useCallback((nextPages) => {
        setPages(nextPages);

        if (activeTableId) {
            const matchesActiveTable = (page) => resolvePageTableId(page, nextPages) === activeTableId;
            const cachedVisible = visibleTableRecordsById[activeTableId];
            setTableNotes(cachedVisible || getVisibleTableRecords(nextPages, activeTableId, nextPages));
            setTableTemplates(nextPages.filter(page => matchesActiveTable(page) && page.metadata?.is_template));
        }

        setGlobalIndex(Object.fromEntries(
            nextPages.map(page => [page.id, page.title || 'Sense títol'])
        ));
    }, [activeTableId, getVisibleTableRecords, resolvePageTableId, visibleTableRecordsById]);


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

    const fetchPages = useCallback(async () => {
        try {
            setLoading(true);
            const res = await axios.get('/api/vault/pages');
            syncPagesState(res.data);
            setLoading(false);
            return res.data;
        } catch (err) {
            console.error(err);
            toast.error("Error carregant les pàgines.");
            setLoading(false);
            return [];
        }
    }, [syncPagesState]);

    const fetchRegistry = useCallback(async (attempt = 0) => {
        if (attempt === 0) {
            setIsRegistryLoading(true);
        }
        try {
            const res = await axios.get('/api/vault/registry');
            setRegistry(res.data);
            setIsRegistryLoading(false);
        } catch (err) {
            console.error("Error carregant el registre:", err);
            if (attempt < 2) {
                setTimeout(() => fetchRegistry(attempt + 1), 800);
                return;
            }
            setIsRegistryLoading(false);
            toast.error("Error de connexió amb el backend. Verifica que el servidor estigui actiu.");
        }
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
                setGlobalIndex(Object.fromEntries(merged.map(page => [page.id, page.title || 'Sense títol'])));
                return merged;
            });

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
            console.error('Error carregant pàgines de la taula:', err);
            return [];
        }
    }, [isAbortLikeError, resolvePageTableId, shouldIncludeTableRecord]);

    const loadPage = useCallback(async (pageId, fromHistory = false) => {
        try {
            if (!pageId) return;
            const tabId = pageId;
            const existingTab = tabs.find(t => t.id === tabId);
            if (existingTab) {
                setActiveTabId(tabId);
                setViewMode('editor');
                setActiveTableId(null);
                if (!fromHistory) pushToHistory({ type: 'editor', id: pageId });
                return;
            }

            const res = await fetchPageById(pageId);
            if (!res) return;
            const pageData = res.data;
            const tableIdOfPage = resolvePageTableId(pageData);
            if (tableIdOfPage) await fetchPagesByTable(tableIdOfPage);

            const newTab = {
                id: tabId,
                title: pageData.title || "Sense títol",
                content: pageData.content || "",
                metadata: pageData.metadata || {},
                isTable: false
            };
            setTabs(prev => [...prev, newTab]);
            setActiveTabId(tabId);
            setViewMode('editor');
            setActiveTableId(null);
            if (!fromHistory) pushToHistory({ type: 'editor', id: pageId });
        } catch (err) {
            if (isAbortLikeError(err)) return;
            console.error("Error carregant la pàgina:", err);
            toast.error("Error carregant la pàgina");
        }
    }, [fetchPageById, fetchPagesByTable, isAbortLikeError, pushToHistory, resolvePageTableId, tabs]);

    const handleUpdateNote = useCallback(async (id, data) => {
        try {
            await axios.patch(`/api/vault/pages/${id}`, data);
            await fetchPages();
            const page = pages.find(p => p.id === id);
            const tableIdOfPage = resolvePageTableId(page);
            if (tableIdOfPage) await fetchPagesByTable(tableIdOfPage);
        } catch (err) {
            console.error("Error actualitzant nota:", err);
            toast.error("Error al desar la nota");
        }
    }, [fetchPages, fetchPagesByTable, pages, resolvePageTableId]);

    const fetchSchema = useCallback(async (databaseId) => {
        try {
            const res = await axios.get(`/api/vault/schema?folder=${databaseId}`);
            setSchema(res.data);
        } catch (err) {
            console.error(err);
        }
    }, []);

    const fetchViews = useCallback(async (databaseId) => {
        try {
            const res = await axios.get(`/api/vault/views?folder=${databaseId}`);
            setViews(res.data);
        } catch (err) {
            console.error(err);
        }
    }, []);

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
            toast.error("Error desant la nova vista.");
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
            // Refresquem les pàgines de la taula actual per mostrar possibles nous registres d'alta ràpida
            if (activeTableId) {
                await fetchPagesByTable(activeTableId);
            }
        } catch (err) {
            console.error("Error actualitzant vista:", err);
            toast.error("Error al desar els canvis de la vista");
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
            name: `${view.name} (Còpia)`,
            order: (view.order !== undefined ? view.order : 0) + 0.5,
            table_id: view.table_id || activeTableId,
            is_main: false,
        };
        try {
            await axios.post('/api/vault/views', newView);
            await fetchRegistry();
            setActiveViewId(newView.id);
            toast.success("Vista duplicada");
        } catch (err) {
            console.error("Error duplicant vista:", err);
            toast.error("Error al duplicar la vista");
        }
    };

    const handleDeleteView = (targetView) => {
        const view = typeof targetView === 'object' ? targetView : registry.views?.find(v => v.id === targetView);
        if (!view) return;
        const tableViews = getTableViews(view.table_id || activeTableId);
        if (isMainView(view, tableViews)) {
            toast.error("No es pot eliminar la vista principal");
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
            toast.success("Vista eliminada");
        } catch (err) {
            console.error("Error eliminant vista:", err);
            toast.error("Error al eliminar la vista");
        } finally {
            setViewToDelete(null);
        }
    };

    const handleReorderViews = async (reorderedViews) => {
        try {
            const updates = reorderedViews.map((v, idx) => ({ ...v, order: idx }));
            await Promise.all(updates.map(v => axios.post('/api/vault/views', v)));
            await fetchRegistry();
            setViews(reorderedViews);
        } catch (err) {
            console.error("Error reordenant vistes:", err);
            toast.error("Error al reordenar les vistes");
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
                    title = templateData.title || "Nou";
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
            toast.success("Registre creat");
            loadPage(res.data.id);
        } catch (err) {
            console.error("Error creant el registre:", err);
            toast.error("Error creant el registre");
        }
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
    }, []);

    // Sincronitzar URL -> Estat Intern
    useEffect(() => {
        if (!nestedPath || !registry.tables) return;

        const parts = nestedPath.split('/');
        // Casos: table/:id, table/:id/view/:id, page/:id, drawing, view/:id
        if (parts[0] === 'table' && parts[1]) {
            const tableId = parts[1];
            const viewId = parts[3]; // table/:id/view/:id
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
            if (table) {
                handleTableSelect(table.id, null, true);
            } else {
                const page = pages.find(p => p.id === id);
                if (page) loadPage(page.id, true);
            }
        }
    }, [nestedPath, registry.tables, pages]);

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

    // Escoltadors de teclat per a Cmd+K / Ctrl+K i Escape
    useEffect(() => {
        const handleKeyDown = (e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                e.preventDefault();
                setIsGlobalSearchOpen(open => !open);
            }
            if (e.key === 'Escape') {
                setPageToDelete(null);
                setIsGlobalSearchOpen(false);
                setIsRecentOpen(false);
                closePromptModal();
            }
        };

        const handleFolderOpen = (e) => {
            if (e.detail?.folder) {
                // Retrocompatibilitat per Database block clics, provar d'obrir la database o la pàgina mare
                loadPage(e.detail.folder);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('vault-open-folder', handleFolderOpen);

        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('vault-open-folder', handleFolderOpen);
        };
    }, []);

    // Dreceres Undo/Redo globals (usem refs per evitar closures obsoletes)
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
        if (!fromHistory) {
            pushToHistory({ type: 'table', id: tableId, subId: viewId });
        }
        setActiveTableId(tableId);
        setViewMode('table');
        setActiveTabId(null);

        // Buscar notes que pertanyin a aquesta taula.
        // Font única: resolved_table_id (backend). Fallback legacy: metadata table_id/database_table_id.
        const matchesTable = (p) => {
            const resolvedTableId = resolvePageTableId(p);
            return resolvedTableId === tableId;
        };
        const filtered = getTableVisibleRecords(tableId);
        setTableNotes(filtered);

        // Buscar plantilles d'aquesta taula
        const templates = pages.filter(p => matchesTable(p) && p.metadata?.is_template);
        setTableTemplates(templates);
        void fetchPagesByTable(tableId);
        if (registry.tables.find(t => t.id === tableId)) {
            setSchema(getSchemaFromTableId(tableId));
        }

        // Obtenir la vista per defecte de la taula
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
        // Migració instantània de taules antigues a sistema de vistes
        // If no views exist for this table, create a default one
        if (tableViews.length === 0) {
            const defaultId = uuidv4();
            // setActiveViewId(defaultId); // This is now handled by the 'default' above
            axios.post(`/api/vault/views`, {
                id: defaultId,
                table_id: tableId,
                name: MAIN_VIEW_NAME,
                type: "table",
                sort: { field: "last_modified", direction: "desc" },
                filters: [],
                is_main: true,
            }).then(() => fetchRegistry()).catch(err => console.error("Error auto-creant vista:", err));
        }
    }, [pushToHistory, setActiveTableId, setViewMode, setActiveTabId, resolvePageTableId, getTableVisibleRecords, setTableNotes, pages, setTableTemplates, fetchPagesByTable, registry.tables, registry.views, getSchemaFromTableId, setViews, setActiveViewId, getPreferredInitialViewId, fetchRegistry]);

    const focusPageTab = useCallback((pageId) => {
        setActiveTabId(pageId);
        setViewMode('editor');
        setActiveTableId(null);
        setSplitTabIds(prev => prev.filter(id => id !== pageId));
    }, []);

    const handleEditorUpdate = useCallback((pageId, content, payload = {}) => {
        setTabs(prevTabs => prevTabs.map(tab => {
            if (tab.id !== pageId) return tab;

            return {
                ...tab,
                content,
                title: payload?.title ?? tab.title,
                metadata: payload?.metadata ?? tab.metadata,
            };
        }));
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
            console.error(`Error provant de precarregar pàgina ${pageId}`, err);
            toast.error("Error obrint en paral·lel");
            return false;
        }
    }, [tabs, fetchPageById, setTabs]);

    const handleTabClose = (tabId) => {
        const remainingTabs = tabs.filter(t => t.id !== tabId);
        const remainingSplitTabIds = splitTabIds.filter(id => id !== tabId);

        setTabs(remainingTabs);

        if (activeTabId === tabId) {
            const promotedPaneId = remainingSplitTabIds.find(id => remainingTabs.some(tab => tab.id === id)) || null;
            const fallbackTabId = remainingTabs.length > 0 ? remainingTabs[remainingTabs.length - 1].id : null;
            const nextActiveTabId = promotedPaneId || fallbackTabId;

            if (nextActiveTabId) {
                const nextTab = remainingTabs.find(tab => tab.id === nextActiveTabId);
                setActiveTabId(nextActiveTabId);
                setActiveTableId(nextTab?.isTable ? getTableIdFromTab(nextTab) : null);
                setViewMode(nextTab?.isDrawing ? 'drawing' : 'editor');
                setSplitTabIds(remainingSplitTabIds.filter(id => id !== nextActiveTabId));
            } else if (splitTableIds.length > 0) {
                const promotedTableId = splitTableIds[0];
                setSplitTableIds(prev => prev.filter(id => id !== promotedTableId));
                handleTableSelect(promotedTableId);
            } else {
                setActiveTabId(null);
                setSplitTabIds(remainingSplitTabIds);
            }
            return;
        }

        setSplitTabIds(remainingSplitTabIds);
    };

    useEffect(() => {
        const existingPageIds = new Set(pages.map(page => page.id));
        const existingTableIds = new Set((registry.tables || []).map(table => table.id));

        setTabs(prevTabs => {
            const filteredTabs = prevTabs.filter(tab => {
                if (tab.isTable) {
                    const tableId = getTableIdFromTab(tab);
                    return Boolean(tableId && existingTableIds.has(tableId));
                }
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
    }, [activeTabId, activeTableId, pages, registry.tables, viewMode]);

    const MAX_PANES = 4;

    const handleToggleSplit = useCallback((tabId) => {
        if (tabId === activeTabId) return;

        setSplitTabIds(prev => {
            if (prev.includes(tabId)) return prev.filter(id => id !== tabId);
            if (prev.length + splitTableIds.length + 1 >= MAX_PANES) return prev; // ja tenim actiu + prev
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

    const handleOpenTableParallel = useCallback((tableId) => {
        if (!activeTabId) {
            const fallbackTabId = tabs.length > 0 ? tabs[tabs.length - 1].id : null;
            if (!fallbackTabId) {
                toast.error("Obre primer un recurs per poder fer vista paral·lela");
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
    }, [activeTabId, splitTabIds.length, tabs, setActiveTabId, setViewMode]);

    const handleDuplicateTemplate = async (template) => {
        try {
            const res = await axios.post(`/api/vault/pages`, {
                title: `${template.title} (Còpia)`,
                content: template.content || "",
                is_database: false,
                metadata: {
                    ...template.metadata,
                    id: undefined
                }
            });
            toast.success("Plantilla duplicada");
            const tableIdOfPage = resolvePageTableId(template);
            if (tableIdOfPage) {
                await fetchPagesByTable(tableIdOfPage);
            }
        } catch (err) {
            toast.error("Error duplicant plantilla");
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
            toast.success("Plantilla predeterminada establerta");
            if (targetTableId) {
                await fetchPagesByTable(targetTableId);
            }
        } catch (err) {
            toast.error("Error establint plantilla predeterminada");
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
        } catch (err) {
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
                toast.error("Taula no trobada");
                return;
            }

            const newTab = {
                id: buildTableTabId(tableId),
                title: table.name || "Sense Títol",
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

            if (tableViews.length === 0) {
                const defaultId = uuidv4();
                axios.post(`/api/vault/views`, {
                    id: defaultId,
                    table_id: tableId,
                    name: MAIN_VIEW_NAME,
                    type: "table",
                    sort: { field: "last_modified", direction: "desc" },
                    filters: [],
                    is_main: true,
                }).then(() => fetchRegistry()).catch(err => console.error("Error auto-creant vista:", err));
            }
        } catch (err) {
            console.error("Error obrint la taula:", err);
            toast.error("Error obrint la taula");
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
        } else {
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

    const handleOpenCreatePrompt = (parentId = null, isDatabase = false, isDrawing = false, isDashworks = false) => {
        let defaultTitle = isDatabase ? "Nova Base de Dades" : "Nova Pàgina";
        if (isDrawing) defaultTitle = "Nou Dibuix";
        if (isDashworks) defaultTitle = "Nou Taulell";
        setPromptModal({ 
            isOpen: true, 
            defaultTitle, 
            parentId, 
            isDatabase, 
            isDrawing, 
            isDashworks,
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
        const { inputValue, parentId, isDatabase, isDrawing, isDashworks, isView, isRename, targetView, viewType, folderName, isTemplate, isApp, databaseId } = promptModal;
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
                toast.success("Plantilla creada");
                loadPage(res.data.id);
            } else if (isApp) {
                await axios.post('/api/vault/databases', { name: title });
                await fetchRegistry();
                toast.success(`App "${title}" creada`);
            } else if (isRename) {
                const view = promptModal.targetView;
                if (!view) throw new Error("No s'ha seleccionat cap vista per reanomenar");

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
                toast.success("Vista reanomenada");
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
                setTabs(prev => [...prev, { id: drawingId, title: title, isDrawing: true }]);
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
                toast.success(`Taula "${title}" creada`);
            } else {
                const res = await axios.post(`/api/vault/pages`, {
                    title: title,
                    content: isDashworks ? '{\n  \n}' : ``,
                    parent_id: parentId,
                    is_database: isDatabase,
                    metadata: isDashworks
                        ? {
                            is_dashworks: true,
                            content_format: 'json',
                        }
                        : undefined,
                });
                await fetchPages();
                loadPage(res.data.id);
            }
            closePromptModal();
        } catch (err) {
            toast.error("Error creant el contingut");
            setPromptModal(prev => ({ ...prev, isLoading: false }));
        }
    };

    const handleDeletePage = useCallback((pageId, pageTitle) => {
        setPageToDelete({ id: pageId, title: pageTitle });
    }, []);

    const executeDeletePage = async () => {
        if (!pageToDelete) return;
        const { id } = pageToDelete;
        try {
            await axios.delete(`/api/vault/pages/${id}`);
            setPages(prev => prev.filter(page => page.id !== id));
            toast.success("Pàgina eliminada");
            handleTabClose(id);
            void fetchPages();
        } catch (err) {
            toast.error("Error eliminant la pàgina");
        } finally {
            setPageToDelete(null);
        }
    };

    // ---- ELIMINAR MÚLTIPLES REGISTRES (amb suport Undo) ----
    // Funció que mostra el modal de confirmació
    const handleDeleteSelected = useCallback((selectedIds) => {
        const idArray = [...selectedIds];
        if (idArray.length === 0) return;
        setRecordsToDelete({ ids: idArray, count: idArray.length });
    }, []);

    const executeDeleteSelected = useCallback(async () => {
        const idArray = recordsToDelete?.ids;
        if (!idArray || idArray.length === 0) return;

        const fetchedItems = await Promise.allSettled(
            idArray.map(id => axios.get(`/api/vault/pages/${id}`).then(r => r.data))
        );
        const deletedItems = fetchedItems
            .filter(r => r.status === 'fulfilled')
            .map(r => r.value);

        await Promise.allSettled(
            idArray.map(id => axios.delete(`/api/vault/pages/${id}`))
        );

        setPages(prev => prev.filter(p => !idArray.includes(p.id)));
        idArray.forEach(id => handleTabClose(id));

        setUndoStack(prev => [...prev, { type: 'delete', items: deletedItems }]);
        setRedoStack([]);

        toast.success(`${idArray.length} registre${idArray.length !== 1 ? 's' : ''} eliminat${idArray.length !== 1 ? 's' : ''} · Cmd+Z per desfer`);

        if (activeTableId) {
            void fetchPagesByTable(activeTableId);
        } else {
            void fetchPages();
        }
        setRecordsToDelete(null);
    }, [recordsToDelete, fetchPages, fetchPagesByTable, activeTableId]);

    // ---- DESFER (Undo) ----
    const undoLastOperation = useCallback(async () => {
        if (undoStack.length === 0) return;
        const operation = undoStack[undoStack.length - 1];

        if (operation.type === 'delete') {
            await Promise.allSettled(
                operation.items.map(item =>
                    axios.put(`/api/vault/pages/${item.id}`, {
                        title: item.title || 'Sense títol',
                        content: item.content || '',
                        parent_id: item.parent_id || null,
                        is_database: item.is_database || false,
                        metadata: item.metadata || {}
                    })
                )
            );
            toast.success(`Restaurats ${operation.items.length} registre${operation.items.length !== 1 ? 's' : ''}`);
            void fetchPages();
        }

        setRedoStack(prev => [...prev, operation]);
        setUndoStack(prev => prev.slice(0, -1));
    }, [undoStack]);

    // ---- REFER (Redo) ----
    const redoLastOperation = useCallback(async () => {
        if (redoStack.length === 0) return;
        const operation = redoStack[redoStack.length - 1];

        if (operation.type === 'delete') {
            await Promise.allSettled(
                operation.items.map(item => axios.delete(`/api/vault/pages/${item.id}`))
            );
            const nextPages = pages.filter(p => !operation.items.some(i => i.id === p.id));
            syncPagesState(nextPages);
            operation.items.forEach(item => handleTabClose(item.id));
            toast.success(`Tornat a eliminar ${operation.items.length} registre${operation.items.length !== 1 ? 's' : ''}`);
            void fetchPages();
        }

        setUndoStack(prev => [...prev, operation]);
        setRedoStack(prev => prev.slice(0, -1));
    }, [redoStack, pages, syncPagesState]);

    // Mantenir refs actualitzades (evita closures obsoletes al listener de Cmd+Z)
    useEffect(() => { undoRef.current = undoLastOperation; }, [undoLastOperation]);
    useEffect(() => { redoRef.current = redoLastOperation; }, [redoLastOperation]);

    const handleDuplicatePage = useCallback(async (pageId) => {
        try {
            const res = await axios.post(`/api/vault/pages/${pageId}/duplicate`);
            toast.success("Pàgina duplicada");
            await fetchPages();
            loadPage(res.data.id); 
        } catch (err) {
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
            toast.success("Títol actualitzat");
        } catch (err) {
            toast.error("Error renomenant la pàgina");
        }
    }, [fetchPages, setTabs]);

    const handleToggleFavorite = useCallback(async (pageId) => {
        if (!pageId) return;
        try {
            // Obtenir el contingut de la nota sencera per no perdre dades
            const getRes = await axios.get(`/api/vault/pages/${pageId}`);
            const { content, metadata, title } = getRes.data;

            // Invertir el valor de favorite (tractar undefined com a false prèviament)
            const isFav = metadata.favorite === true || metadata.favorite === 'true';
            const updatedMeta = { ...metadata, favorite: !isFav };

            // Desar la pàgina amb el status de favorit invertit
            await axios.put(`/api/vault/pages/${pageId}`, {
                title: title,
                content: content,
                is_database: updatedMeta.is_database || false,
                parent_id: updatedMeta.parent_id || null,
                metadata: updatedMeta
            });

            // Actualitzem les pestanyes si la targeta favorita estava oberta
            setTabs(prevTabs => prevTabs.map(t =>
                t.id === pageId
                    ? { ...t, metadata: updatedMeta }
                    : t
            ));

            await fetchPages(); // Perquè Sidebar recarregui els preferits
        } catch (err) {
            console.error(err);
            toast.error("Error al canviar preferits");
        }
    }, [fetchPages, setTabs]);

    const handleEditSchema = useCallback((table, tabMetadata) => {
        const tid = table?.id || resolvePageTableId({ metadata: tabMetadata });
        if (!tid) {
            toast('Aquesta pàgina wiki no té una taula global associada.');
            return;
        }
        setActiveTableId(tid);
        setIsSchemaModalOpen(true);
    }, [resolvePageTableId, setActiveTableId, setIsSchemaModalOpen]);

    // Filtrem totes les notes de totes les carpetes per trobar favorites? 
    // Per optimització, de moment només les de la carpeta actual si tenen el tag 'favorite'.
    const favoritePages = pages.filter(p => (p.metadata?.favorite === true || p.metadata?.favorite === 'true') && !p.metadata?.is_template);

    // Mètode recursiu per construir les engrunetes del pa per jerarquia parent->fill
    const buildPageParentBreadcrumbs = (pageId, currentTrail = []) => {
        const page = pages.find(p => p.id === pageId);
        if (!page) return currentTrail;
        const newTrail = [{ label: page.title, onClick: () => loadPage(page.id) }, ...currentTrail];
        if (page.parent_id) {
            return buildPageParentBreadcrumbs(page.parent_id, newTrail);
        }
        return newTrail;
    };

    const buildTableContextBreadcrumbs = (page) => {
        if (!page) return [];
        const tableId = resolvePageTableId(page);
        if (!tableId) return [];

        const table = registry.tables?.find(t => t.id === tableId);
        if (!table) return [];

        const crumbs = [];
        const database = registry.databases?.find(db => db.id === table.database_id);
        if (database) {
            crumbs.push({
                label: database.name,
                onClick: () => handleTableSelect(table.id)
            });
        }

        crumbs.push({
            label: table.name,
            onClick: () => handleTableSelect(table.id)
        });

        return crumbs;
    };

    const breadcrumbs = [
        { label: 'Vault', onClick: () => { setActiveTabId(null); setViewMode('editor'); } }
    ];
    if (activeTabId) {
        const activePage = pages.find(p => p.id === activeTabId);
        const pageBreadcrumbs = buildPageParentBreadcrumbs(activeTabId);
        const hasParentHierarchy = pageBreadcrumbs.length > 1;

        if (!hasParentHierarchy) {
            breadcrumbs.push(...buildTableContextBreadcrumbs(activePage));
        }

        breadcrumbs.push(...pageBreadcrumbs);
    }

    const currentOpenPage = activeTabId ? pages.find(p => p.id === activeTabId) : null;
    const currentActiveTab = activeTabId ? tabs.find(t => t.id === activeTabId) : null;
    const canToggleCodeView = viewMode === 'editor' && Boolean(currentActiveTab && !currentActiveTab.isTable);
    const isCodeViewActive = canToggleCodeView ? Boolean(codeViewByTabId[currentActiveTab.id]) : false;
    const quickOpenItems = React.useMemo(() => {
        const pageItems = pages
            .filter(p => !p.metadata?.is_template)
            .map(page => {
                const tableId = resolvePageTableId(page);
                const table = tableId ? registry.tables?.find(t => t.id === tableId) : null;
                const db = table ? registry.databases?.find(d => d.id === table.database_id) : null;
                const subtitle = table ? `Pàgina • ${db?.name || 'Sense base'} / ${table.name}` : 'Pàgina • Wiki';
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
                subtitle: `Taula • ${db?.name || 'Sense base'}`
            };
        });

        const unique = new Map();
        [...tableItems, ...pageItems].forEach(item => {
            const key = `${item.type}-${item.id}`;
            if (!unique.has(key)) unique.set(key, item);
        });

        return Array.from(unique.values());
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

    // Mida relativa de cada panell (% de l'espai total). Inicialitzada en iguals.
    const [paneSizes, setPaneSizes] = useState([]);
    const paneContainerRef = React.useRef(null);

    // Resincronitza les mides quan canvia el nombre de panells
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
            onCreateDashworksPage={(parentId) => handleOpenCreatePrompt(parentId, false, false, true)}
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
                        toast.success("Database actualitzada");
                    }
                } catch (err) {
                    toast.error("Error al renomenar la database");
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
                    toast.success("Database eliminada");
                } catch (err) {
                    toast.error("Error al eliminar la database");
                }
            }}
            onRenameTable={async (tableId, newName) => {
                try {
                    await axios.put(`/api/vault/tables/${tableId}`, { name: newName });
                    fetchRegistry();
                    toast.success("Taula actualitzada");
                } catch (err) {
                    toast.error("Error al renomenar la taula");
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
                    toast.success("Taula eliminada");
                } catch (err) {
                    toast.error("Error al eliminar la taula");
                }
            }}
            onCreateDatabaseGroup={() => {
                setPromptModal({
                    isOpen: true,
                    defaultTitle: "Nova App / Database",
                    parentId: null,
                    isDatabase: false,
                    isApp: true,
                    isDrawing: false,
                    isView: false,
                    inputValue: "Nova App",
                    isLoading: false
                });
            }}
            onCreateTable={(databaseId) => {
                setPromptModal({
                    isOpen: true,
                    defaultTitle: "Nova Taula",
                    parentId: null,
                    isDatabase: true,
                    isDrawing: false,
                    isView: false,
                    inputValue: "Nova Taula",
                    isLoading: false,
                    databaseId: databaseId // Meta per saber a quina db pertany
                });
            }}
            onCreateTableRecord={(tableId) => handleCreateRecordForTable(tableId)}
            onCreateDrawing={() => handleOpenCreatePrompt(null, false, true)}
        />
    );

    const renderEditor = (tabId) => {
        const tab = tabs.find(t => t.id === tabId);
        if (!tab) return null;

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
                                defaultTitle: "Nova Plantilla",
                                parentId: null,
                                isDatabase: false,
                                isDrawing: false,
                                isView: false,
                                isTemplate: true,
                                inputValue: "Nova Plantilla",
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
                                    <div className="p-0 h-full overflow-y-auto w-full custom-scrollbar bg-slate-50">
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
                                    activeView={cv}
                                    onUpdateView={handleUpdateView}
                                    isListView={cv.type === 'list'}
                                    isEmbedded={false}
                                    onDeletePage={handleDeletePage}
                                    onDeleteSelected={handleDeleteSelected}
                                    onOpenParallel={handleOpenParallel}
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
            <BlockEditor
                key={tab.id}
                noteFilename={tab.id}
                initialContent={tab.content}
                initialMetadata={tab.metadata}
                isCodeView={Boolean(codeViewByTabId[tab.id])}
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
                onRefreshRegistry={fetchRegistry}
                onNoteSelect={loadPage}
                onOpenParallel={handleOpenParallel}
                onEditSchema={(table) => handleEditSchema(table, tab.metadata)}
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
                                <div className="p-0 h-full overflow-y-auto w-full custom-scrollbar bg-slate-50">
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
                                                defaultTitle: "Nova Plantilla",
                                                parentId: null,
                                                isDatabase: false,
                                                isDrawing: false,
                                                isView: false,
                                                isTemplate: true,
                                                inputValue: "Nova Plantilla",
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
                                activeView={cv}
                                onUpdateView={handleUpdateView}
                                isListView={cv.type === 'list'}
                                isEmbedded={true}
                                onDeletePage={handleDeletePage}
                                onDeleteSelected={handleDeleteSelected}
                                onOpenParallel={handleOpenParallel}
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
        <NotionShell
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
                    [currentActiveTab.id]: !Boolean(prev[currentActiveTab.id]),
                }));
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
                                            title="Arrossega per redimensionar"
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
                    ) : viewMode === 'table' && activeTableId ? (
                        <div className="flex-1 flex flex-col overflow-hidden min-w-0 bg-[var(--bg-primary)]">
                            {(() => {
                                const displayViews = getTableViews(activeTableId);

                                return (
                                    <VaultViewsHeader
                                        tableName={activeTable ? (activeTable.title || activeTable.name) : "Taula"}
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
                                                    onDeletePage={handleDeletePage}
                                                    onDeleteSelected={handleDeleteSelected}
                                                    searchTerm={searchTerm}
                                                    onSearchChange={setSearchTerm}
                                                />
                                            </div>
                                        );
                                    }

                                    // Taula o llista
                                    return (
                                        <VaultTable
                                            notes={tableNotes}
                                            templates={tableTemplates}
                                            onNoteSelect={loadPage}
                                            schema={schema}
                                            idToTitle={globalIndex}
                                            activeView={cv}
                                            onUpdateView={handleUpdateView}
                                            isListView={cv.type === 'list'}
                                            onDeletePage={handleDeletePage}
                                            onDeleteSelected={handleDeleteSelected}
                                            onOpenParallel={handleOpenParallel}
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
                                                    defaultTitle: "Nova Plantilla",
                                                    parentId: null,
                                                    isDatabase: false,
                                                    isDrawing: false,
                                                    isView: false,
                                                    isTemplate: true,
                                                    inputValue: "Nova Plantilla",
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
                pageToDelete && (
                    <ConfirmModal
                        isOpen={!!pageToDelete}
                        onClose={() => setPageToDelete(null)}
                        onConfirm={executeDeletePage}
                        title="Eliminar Pàgina"
                        message={`Estàs segur que vols eliminar la pàgina "${pageToDelete.title}"? Aquesta acció no es pot desfer.`}
                        confirmText="Eliminar"
                        isDestructive={true}
                    />
                )
            }

            {
                recordsToDelete && (
                    <ConfirmModal
                        isOpen={!!recordsToDelete}
                        onClose={() => setRecordsToDelete(null)}
                        onConfirm={executeDeleteSelected}
                        title="Eliminar Registres"
                        message={`Estàs segur que vols eliminar ${recordsToDelete.count} registre${recordsToDelete.count !== 1 ? 's' : ''}? Aquesta acció no es pot desfer.`}
                        confirmText="Eliminar"
                        isDestructive={true}
                    />
                )
            }

            {
                viewToDelete && (
                    <ConfirmModal
                        isOpen={!!viewToDelete}
                        onClose={() => setViewToDelete(null)}
                        onConfirm={executeDeleteView}
                        title="Eliminar Vista"
                        message={`Estàs segur que vols eliminar la vista "${viewToDelete.name}"? Aquesta acció no es pot desfer.`}
                        confirmText="Eliminar"
                        isDestructive={true}
                    />
                )
            }

            {
                promptModal.isOpen && (
                    <div
                        className="fixed inset-0 bg-black/60 backdrop-blur-[2px] z-[100] flex items-center justify-center p-4"
                                    onClick={closePromptModal}
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
                                {promptModal.isRename ? `Reanomenar Vista: ${promptModal.targetView?.name}` :
                                    (promptModal.isView ? "Nova Vista" :
                                        (promptModal.isDrawing ? "Crear Nou Dibuix" :
                                            (promptModal.isDashworks ? "Crear Nou Taulell" :
                                            (promptModal.isDatabase && promptModal.databaseId ? "Crear Nova Taula" :
                                                (promptModal.isApp ? "Crear Nova App/DB" :
                                                    (promptModal.isTemplate ? "Desar com a Plantilla" : "Crear Nova Pàgina"))))))}
                            </h3>
                            <div className="mb-6">
                                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
                                    {promptModal.isRename ? "Quin és el nou nom?" : "Quin nom vols posar-li?"}
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
                                    Cancel·lar
                                </button>
                                <button
                                    type="submit"
                                    disabled={promptModal.isLoading || !promptModal.inputValue.trim()}
                                    className="px-4 py-2 text-sm font-medium text-white bg-gnosi hover:bg-gnosi/90 rounded-md transition-colors shadow-sm disabled:opacity-50 flex items-center gap-2"
                                >
                                    {promptModal.isLoading && <Loader2 size={16} className="animate-spin" />}
                                    {promptModal.isRename ? "Reanomenar" : "Crear"}
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
                            folder={activeTable?.name || 'Taula'}
                            currentSchema={currentSchemaObj}
                            initialEnableSubitems={cv?.enableSubitems}
                            initialVisibleProperties={cv?.is_main ? getSchemaFieldNames(currentSchemaObj) : cv?.visibleProperties}
                            onSchemaUpdated={(newSchema) => setSchema(newSchema)}
                            onSave={async (newSchemaObj, viewConfig) => {
                                const newProperties = buildTablePropertiesFromSchema(newSchemaObj);
                                try {
                                    // 1. Actualitzar l'esquema de la taula (Backend registry)
                                    await axios.post(`/api/vault/tables`, {
                                        ...activeTable,
                                        properties: newProperties
                                    });
                                    setSchema(newSchemaObj);

                                    // 2. Actualitzar la configuració de la vista si existeix
                                    if (cv?.id) {
                                        await handleUpdateView({
                                            ...cv,
                                            enableSubitems: viewConfig.enableSubitems,
                                            visibleProperties: cv?.is_main ? getSchemaFieldNames(newSchemaObj) : viewConfig.visibleProperties
                                        });
                                    }

                                    await fetchRegistry();
                                    toast.success("Estructura i vista actualitzades");
                                    setIsSchemaModalOpen(false);
                                } catch (err) {
                                    console.error("Error desant estructura:", err);
                                    toast.error("Error desant la configuració");
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
                            await handleSaveViewConfig(config);
                            setIsViewConfigOpen(false);
                            setViewToConfigure(null);
                        }}
                    />
                )
            }
        </NotionShell >
    );
}
