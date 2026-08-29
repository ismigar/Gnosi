import React, { useState, useEffect, useCallback, useRef, Suspense, lazy } from 'react';
import { useNavigate, useParams, useNavigationType } from 'react-router-dom';
import axios from '../shared/api/legacy-http';
import { fetchBrainTableStatus, fetchLlmWikiConfig } from '../shared/api/brain';
import { openDailyNote } from '../shared/api/daily-notes';
import { fetchResourceProcessingStatus } from '../shared/api/resource-processing';
import {
    createVaultPage,
    fetchVaultPage,
    fetchVaultRegistry,
} from '../shared/api/vaults';
import {
    createVaultView,
    deleteVaultView,
    fetchVaultViewUsage,
    reorderVaultViews,
    updateVaultView,
} from '../shared/api/vault-views';
import { toast } from '../lib/toast';
import { v4 as uuidv4 } from 'uuid';
import { logError, notifyError } from '../lib/notifyError';
import { FileText, Loader2, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { VaultShell } from '../components/Vault/VaultShell';
import { VaultSidebar } from '../components/Vault/VaultSidebar';
import { VaultViewBody } from '../components/Vault/VaultViewBody';
import { canCreateNotebookFromTable } from '../lib/notebookTableActions';
import { BlockEditor } from '../components/Vault/BlockEditor';
import { inFlightSaves } from '../components/Vault/editorState';
import { SchemaConfigModal } from '../components/Vault/SchemaConfigModal';
import { PageViewModal } from '../components/Vault/PageViewModal';
import { GlobalSearchModal } from '../components/Vault/GlobalSearchModal';
import TagsModal from '../components/Vault/TagsModal';
import PresentationMode from '../components/Vault/PresentationMode';
import InlineComments from '../components/Vault/InlineComments';
import WorkspacesModal from '../components/Vault/WorkspacesModal';
import { MetadataLookupModal } from '../components/Vault/MetadataLookupModal';
import { RecentModal } from '../components/Vault/RecentModal';
import { TranslateLanguagesModal } from '../components/Vault/TranslateLanguagesModal';
import { VaultDocumentTabs } from '../components/Vault/VaultDocumentTabs';
import { ZoteroReaderTab } from '../components/Vault/ZoteroReaderTab';
import { VaultViewsHeader } from '../components/Vault/VaultViewsHeader';
import { selectResourceTemplate } from '../components/Vault/resourceTemplateSelection';
import VaultDrawings from '../components/Vault/VaultDrawings';
import { VaultGraph } from '../components/Vault/VaultGraph';
import { VaultTrashView } from '../components/Vault/VaultTrashView';
import { VaultTagsView } from '../components/Vault/VaultTagsView';
import { PageComments } from '../components/Vault/PageComments';
import { ShareModal } from '../components/Vault/ShareModal';
import { usePlugins } from '../plugins/usePlugins';
import { MAIN_VIEW_NAME, isMainView, isProtectedMainView, isViewHidden } from '../components/Vault/viewConstants';
import { buildSchemaFromTableProperties, buildTablePropertiesFromSchema, getSchemaFieldNames, isCalendarPage } from '../components/Vault/schemaUtils';
import { applyDefaultFormulasToMetadata } from '../components/Vault/defaultFormulaUtils';
import { isGlobalSearchShortcut } from '../components/Vault/globalSearchUtils';
import { Palette } from 'lucide-react';
import ConfirmModal from '../components/ConfirmModal';
import { ProcessResourceModal } from '../components/Vault/ProcessResourceModal';
import {
    RELATION_UNLINKED_EVENT,
    RELATION_VALUE_APPLIED_EVENT,
} from '../components/Vault/relationItemUtils';
import { documentTabId } from '../lib/fileResource';
import { vaultAgentContextRefs, vaultPageViewIds } from '../lib/vaultAgentContext';
import { knowledgeDocumentType, vaultPath } from '../lib/vaultRouting';
// The drawing editor (tldraw) is very heavy and is only used in 'drawing' mode:
// we load it lazily so it doesn't end up in the Vault chunk.
const TldrawEditor = lazy(() => import('../components/Vault/TldrawEditor'));

// The references table is NO longer detected by heuristics (name or column
// "Citation Key") but rather by the designation from Settings — backend
// `get_reference_table_id`. The frontend receives it via GET /api/vault/reference-table
// (state `refTableId`), and all reference controls are based on it.

function prepareDashboardViewContext(cv, table, allTables) {
    if (!cv) return { mergedView: cv, mergedSchema: {} };
    const rawVisible = cv.visibleProperties || cv.visible_properties || cv.columns || ['title'];
    const stringColumns = Array.isArray(rawVisible) 
        ? rawVisible.map(c => typeof c === 'string' ? c : (c?.fieldKey || 'title'))
        : ['title'];
    const mergedView = { ...cv, visibleProperties: stringColumns };

    const props = [...(table?.properties || [])];
    if (cv.joins && Array.isArray(cv.joins)) {
        cv.joins.forEach(j => {
            const jt = allTables?.find(t => String(t.id) === String(j.tableId));
            if (jt && jt.properties) {
                jt.properties.forEach(p => {
                    if (!props.some(x => x.name === p.name)) props.push(p);
                });
            }
        });
    }
    const mergedSchema = buildSchemaFromTableProperties(props);
    return { mergedView, mergedSchema };
}

function _indexByField(rows, field) {
    const idx = new Map();
    for (const r of rows) {
        const meta = r.metadata || {};
        let val;
        if (field === 'id') val = r.id;
        else if (field === 'title') val = r.title || meta.title || meta.Nom || meta.Títol || meta.Name || meta.Título;
        else val = meta[field];
        if (val === null || val === undefined || val === '') continue;
        const keys = Array.isArray(val) ? val.map(v => typeof v === 'object' && v !== null ? String(v.id || v.value || '') : String(v)).filter(v => v) : [String(val)];
        for (const k of keys) {
            if (!idx.has(k)) idx.set(k, []);
            idx.get(k).push(r);
        }
    }
    return idx;
}

function applyDashboardJoins(baseRows, joins, allPages, resolveTableId) {
    if (!Array.isArray(joins) || joins.length === 0) return baseRows;
    let acc = baseRows.map(r => ({ ...r, metadata: { ...(r.metadata || {}) } }));
    console.log('[DashboardJoins] Start with', acc.length, 'base rows, joins:', joins);
    for (const join of joins) {
        const tid = join && join.tableId;
        const lf = join && (join.leftField || join.field);
        const rf = join && (join.rightField || join._indexByField);
        const type = String((join && join.type) || 'inner').toLowerCase();
        console.log(`[DashboardJoins] Processing join: tid=${tid}, lf=${lf}, rf=${rf}, type=${type}`);
        if (!tid || !lf || !rf) continue;
        const right = allPages.filter(p => resolveTableId(p) === tid);
        console.log(`[DashboardJoins] Right table pages count: ${right.length}`);
        const ridx = _indexByField(right, rf);
        console.log(`[DashboardJoins] Right table index size: ${ridx.size}`);
        console.log(`[DashboardJoins] Join ${type} on ${lf} = ${rf}. Right table ${tid} has ${right.length} rows.`);
        console.log(`[DashboardJoins] Right index size:`, ridx.size, 'Sample keys:', Array.from(ridx.keys()).slice(0, 3));
        const next = [];
        if (type === 'right') {
            const matched = new Set();
            for (const a of acc) {
                const meta = a.metadata || {};
                let lv;
                if (lf === 'id') lv = a.id;
                else if (lf === 'title') lv = a.title || meta.title || meta.Nom || meta.Títol || meta.Name || meta.Título;
                else lv = meta[lf];
                const keys = Array.isArray(lv) ? lv.map(v => typeof v === 'object' && v !== null ? String(v.id || v.value || '') : String(v)).filter(v => v) : (lv !== '' && lv != null ? [String(lv)] : []);
                for (const k of keys) {
                    for (const rr of (ridx.get(k) || [])) {
                        matched.add(String(rr.id));
                        const merged = { ...a, metadata: { ...meta } };
                        for (const [fk, fv] of Object.entries(rr.metadata || {})) {
                            if (!(fk in merged.metadata)) merged.metadata[fk] = fv;
                        }
                        merged.metadata[`_join:${tid}`] = [rr.metadata || {}];
                        next.push(merged);
                    }
                }
            }
            for (const rr of right) {
                if (!matched.has(String(rr.id))) {
                    const merged = { ...rr, metadata: { ...(rr.metadata || {}) } };
                    merged.metadata[`_join:${tid}`] = [rr.metadata || {}];
                    next.push(merged);
                }
            }
        } else if (type === 'left') {
            for (const a of acc) {
                const meta = a.metadata || {};
                let lv;
                if (lf === 'id') lv = a.id;
                else if (lf === 'title') lv = a.title || meta.title || meta.Nom || meta.Títol || meta.Name || meta.Título;
                else lv = meta[lf];
                const keys = Array.isArray(lv) ? lv.map(v => typeof v === 'object' && v !== null ? String(v.id || v.value || '') : String(v)).filter(v => v) : (lv !== '' && lv != null ? [String(lv)] : []);
                let didMatch = false;
                for (const k of keys) {
                    for (const rr of (ridx.get(k) || [])) {
                        didMatch = true;
                        const merged = { ...a, metadata: { ...meta } };
                        for (const [fk, fv] of Object.entries(rr.metadata || {})) {
                            if (!(fk in merged.metadata)) merged.metadata[fk] = fv;
                        }
                        merged.metadata[`_join:${tid}`] = [rr.metadata || {}];
                        next.push(merged);
                    }
                }
                if (!didMatch) {
                    const merged = { ...a, metadata: { ...meta } };
                    merged.metadata[`_join:${tid}`] = [];
                    next.push(merged);
                }
            }
        } else {
            // inner
            for (const a of acc) {
                const meta = a.metadata || {};
                let lv;
                if (lf === 'id') lv = a.id;
                else if (lf === 'title') lv = a.title || meta.title || meta.Nom || meta.Títol || meta.Name || meta.Título;
                else lv = meta[lf];
                const keys = Array.isArray(lv) ? lv.map(v => typeof v === 'object' && v !== null ? String(v.id || v.value || '') : String(v)).filter(v => v) : (lv !== '' && lv != null ? [String(lv)] : []);
                for (const k of keys) {
                    for (const rr of (ridx.get(k) || [])) {
                        const merged = { ...a, metadata: { ...meta } };
                        for (const [fk, fv] of Object.entries(rr.metadata || {})) {
                            if (!(fk in merged.metadata)) merged.metadata[fk] = fv;
                        }
                        merged.metadata[`_join:${tid}`] = [rr.metadata || {}];
                        next.push(merged);
                    }
                }
            }
        }
        console.log(`[DashboardJoins] After join, acc length: ${next.length}`);
        acc = next;
    }
    return acc;
}

export default function VaultDashboard() {
    const { t, i18n } = useTranslation();
    const navigate = useNavigate();
    const { "*": nestedPath } = useParams();

    const [pages, setPages] = useState([]);
    const pagesRef = useRef([]);
    const viewCreationInProgressRef = useRef(new Set());
    const [tabs, setTabs] = useState([]);
    const [activeTabId, setActiveTabId] = useState(null);
    const [recordReturnFocus, setRecordReturnFocus] = useState(null);
    const recordReturnFocusSequenceRef = useRef(0);
    const consumedRecordReturnFocusRef = useRef(null);
    const [codeViewByTabId, setCodeViewByTabId] = useState({});
    // Per-page edit lock (by ID). Persisted to localStorage so that
    // the lock survives a browser reload. When it's locked (true), the
    // BlockEditor renders as read-only and blocks all the
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
    const [viewToDeleteUsage, setViewToDeleteUsage] = useState(null);
    const [templateToDelete, setTemplateToDelete] = useState(null);
    const [promptModal, setPromptModal] = useState({ isOpen: false, defaultTitle: '', parentId: null, isDatabase: false, isDrawing: false, isDashboard: false, isView: false, isRename: false, isTemplate: false, templateTableId: null, targetView: null, viewType: null, inputValue: '', isLoading: false });

    // Plugins (optional features): per-vault activation (internal registry).
    const { isEnabled: isPluginEnabled } = usePlugins();
    const isPluginEnabledRef = useRef(isPluginEnabled);
    isPluginEnabledRef.current = isPluginEnabled;
    const [llmWikiConfig, setLlmWikiConfig] = useState(null);
    const [llmWikiJobs, setLlmWikiJobs] = useState({});
    const [resourceToProcess, setResourceToProcess] = useState(null);
    const [backgroundLlmWikiJobs, setBackgroundLlmWikiJobs] = useState({});

    useEffect(() => {
        let alive = true;
        if (!isPluginEnabled('llm-wiki')) {
            setLlmWikiConfig(null);
            setLlmWikiJobs({});
            return () => { alive = false; };
        }
        fetchLlmWikiConfig()
            .then((response) => {
                if (!alive) return;
                setLlmWikiConfig(response?.config
                    ? {
                        ...response.config,
                        processed_resources: response.processed_resources || {},
                    }
                    : null);
                setLlmWikiJobs(response?.resource_statuses || {});
            })
            .catch((error) => {
                if (alive) {
                    setLlmWikiConfig(null);
                    setLlmWikiJobs({});
                }
                console.warn('Could not load the LLM Wiki page-action configuration:', error);
            });
        return () => { alive = false; };
    }, [isPluginEnabled]);

    // For now we support "editor" for all pages.
    // You can add "table" directly here or via custom blocks.
    const [viewMode, setViewMode] = useState('editor');

    // No more currentFolder, everything is just ID contexts
    const [schema, setSchema] = useState({});
    const [views, setViews] = useState([]);
    const [activeViewId, setActiveViewId] = useState(null);
    const [isGlobalSearchOpen, setIsGlobalSearchOpen] = useState(false);
    const [isTagsOpen, setIsTagsOpen] = useState(false);
    const [isPresentOpen, setIsPresentOpen] = useState(false);
    const [isWorkspacesOpen, setIsWorkspacesOpen] = useState(false);
    const [isRecentOpen, setIsRecentOpen] = useState(false);
    // Id of the page for which the «Translate page» modal is open (null = closed).
    const [translatePageModalId, setTranslatePageModalId] = useState(null);
    // Mode of the translation modal opened from the page menu: 'row' translates
    // the translatable fields into a subitem (translatable table row); 'page'
    // translates title + body into a subpage (normal page). See GAP 2.
    const [translatePageMode, setTranslatePageMode] = useState('page');
    const [historyOpenSignal, setHistoryOpenSignal] = useState(0);
    const [commentsOpen, setCommentsOpen] = useState(false);
    const [shareOpen, setShareOpen] = useState(false);
    const [globalIndex, setGlobalIndex] = useState({});
    // Map id → [note aliases] (frontmatter `aliases:`). Feeds the resolution
    // and wikilink suggestions by alias (Obsidian-style).
    const [aliasIndex, setAliasIndex] = useState({});
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

    // --- Action History (Undo/Redo) ---
    const [undoStack, setUndoStack] = useState([]);
    const [redoStack, setRedoStack] = useState([]);
    const undoRef = useRef(null);
    const redoRef = useRef(null);
    const pendingRelationUndoRef = useRef(null);
    // Mirrors of the stack sizes for the global Cmd+Z listener (deps `[]`).
    // Without this, the handler would hijack (preventDefault) the shortcut even when there
    // is no table operation to undo, swallowing the editor's undo
    // when focus isn't exactly inside the contenteditable (e.g. when opening
    // the page or right after an interaction that moves focus to the body).
    const undoStackLenRef = useRef(0);
    const redoStackLenRef = useRef(0);
    // Mirrors of the active view for handlers that live in effects with
    // deps `[]` (e.g. `handleOpenPdf`): reading the state directly there
    // would be stale. We use them to remember WHERE a document is opened from and to be able to
    // return there when closing it.
    const activeTableIdRef = useRef(null);
    const activeTabIdRef = useRef(null);
    const activeViewIdRef = useRef(null);
    const viewModeRef = useRef('editor');
    const TABLE_TAB_PREFIX = 'table:';
    // Stable prefix to identify a PDF/EPUB/snapshot tab. Reuses
    // the tab when the user clicks the same document twice.

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
        // React Router Navigation (URL Synchronization)
        if (entry.type === 'table') {
            const url = entry.subId
                ? vaultPath('knowledge', `table/${entry.id}/view/${entry.subId}`)
                : vaultPath('knowledge', `table/${entry.id}`);
            navigate(url);
        } else if (entry.type === 'editor') {
            const resourceType = entry.resourceType || knowledgeDocumentType(entry);
            navigate(vaultPath('knowledge', `${resourceType}/${encodeURIComponent(entry.id)}`));
        } else if (entry.type === 'drawing') {
            const drawingPath = entry.id
                ? `drawing/${encodeURIComponent(entry.id)}`
                : 'drawing';
            navigate(vaultPath('knowledge', drawingPath));
        }

        setNavigationHistory(prev => {
            const next = prev.slice(0, historyPointer + 1);
            // Avoid consecutive duplicates of the same ID and type
            if (next.length > 0 && next[next.length - 1].id === entry.id && next[next.length - 1].type === entry.type && next[next.length - 1].subId === entry.subId) {
                return next;
            }
            // Saves the origin (the location we're leaving) so the breadcrumb can
            // return to the actual place the entry was opened from (e.g. a dashboard),
            // not just to the table the record structurally belongs to.
            const prevTop = next.length > 0 ? next[next.length - 1] : null;
            const from = prevTop ? { type: prevTop.type, id: prevTop.id, subId: prevTop.subId } : null;
            return [...next, { ...entry, from }];
        });
        setHistoryPointer(prev => prev + 1);
    }, [historyPointer, navigate]);

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
            isTemplate: false,
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

    // Optimistic patch of the sidebar: BlockEditor calls it before (or in
    // parallel) to the backend's PATCH for discrete changes like icon or
    // cover, so the sidebar refreshes right away without waiting for the
    // full page re-fetch.
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

    // Table where a resource must be created from an external source (DOI/ISBN/arXiv/
    // PMID/URL/PDF). When it's not null, the MetadataLookupModal opens in 'create' mode.
    const [createSourceTableId, setCreateSourceTableId] = useState(null);

    // Id of the references table designated in Settings — source of truth for
    // all reference gating (import/export, Citation Key, "Create from a
    // source"). If the user changes it in Settings, all functionality follows it.
    const [refTableId, setRefTableId] = useState(null);
    const createNotebookFromSelection = useCallback((selectedIds) => {
        const resourceIds = [...(selectedIds || [])].map(String);
        if (!resourceIds.length) return;
        window.dispatchEvent(new CustomEvent('gnosi:create-notebook', {
            detail: { resourceIds },
        }));
    }, []);
    const refreshReferenceTable = useCallback(async () => {
        try {
            const { data } = await axios.get('/api/vault/reference-table');
            setRefTableId(data?.table_id || null);
        } catch { /* no designation or backend busy → gating disabled */ }
    }, []);
    useEffect(() => { refreshReferenceTable(); }, [refreshReferenceTable]);

    // Id of the Cervell (LLM Wiki) table — gates the «Bústia del Cervell»
    // (pending permanent-note suggestions) in that table's header.
    const [brainTableId, setBrainTableId] = useState(null);
    useEffect(() => {
        fetchBrainTableStatus()
            .then(status => setBrainTableId(status?.table_id || null))
            .catch(() => { /* no designation → gating disabled */ });
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

    // ---- Back/forward navigation: built on the browser's REAL history ----
    // All navigation within the Vault goes through `pushToHistory → navigate()`, so
    // the browser history is the complete record. We drive the arrows
    // with `navigate(-1)`/`navigate(1)` so they behave EXACTLY like the
    // browser: URL, content, and state always in sync. (Previously there was a
    // internal pointer stack that changed the content without rewriting the URL →
    // offset; and the 1st navigation didn't enable "back" because the start wasn't
    // was registering as an entry.)
    //
    // React Router v7 stores the position in `window.history.state.idx`: numeric,
    // increments with every SPA navigation and survives reload. `idx > 0` = there is a
    // previous Gnosi page (idx=0 = fresh/external entry, nothing to go back to).
    const getBrowserHistoryIndex = () => {
        if (typeof window === 'undefined') return 0;
        const idx = window.history.state?.idx;
        return typeof idx === 'number' ? idx : 0;
    };

    // To know if there's FORWARD we need the max reached (the browser doesn't expose it).
    // PUSH (new navigation) truncates forward → the max drops to the current index;
    // POP/REPLACE (back/forward/reload) never lower the max.
    const navigationType = useNavigationType();
    const browserHistoryIndex = getBrowserHistoryIndex();
    const maxBrowserHistoryIndexRef = useRef(browserHistoryIndex);
    if (navigationType === 'PUSH') {
        maxBrowserHistoryIndexRef.current = browserHistoryIndex;
    } else if (browserHistoryIndex > maxBrowserHistoryIndexRef.current) {
        maxBrowserHistoryIndexRef.current = browserHistoryIndex;
    }

    const canGoBack = browserHistoryIndex > 0;
    const canGoForward = browserHistoryIndex < maxBrowserHistoryIndexRef.current;

    // navigate(-1/+1) = browser back/forward: triggers `popstate` → the effect
    // "Sync URL → Internal State" loads the page (or the home) with
    // fromHistory=true, without creating new entries or touching the internal stack.
    const handleNavigationBack = () => { if (canGoBack) navigate(-1); };
    const handleNavigationForward = () => { if (canGoForward) navigate(1); };
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
            // 503 with Retry-After: the backend tells us the index is still
            // warming up. We retry honoring the header (fallback 2s).
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

    useEffect(() => {
        const jobs = Object.values(backgroundLlmWikiJobs);
        if (jobs.length === 0) return undefined;
        let alive = true;
        const pollBackgroundJobs = async () => {
            await Promise.all(jobs.map(async (job) => {
                try {
                    const nextJob = await fetchResourceProcessingStatus(
                        job.job_id,
                        job.source_table_id,
                    );
                    if (!alive) return;
                    setLlmWikiJobs((current) => ({
                        ...current,
                        [job.source_table_id]: {
                            ...(current[job.source_table_id] || {}),
                            [job.resource_id]: nextJob,
                        },
                    }));
                    if (nextJob.running) return;
                    setBackgroundLlmWikiJobs((current) => {
                        const next = { ...current };
                        delete next[job.job_id];
                        return next;
                    });
                    if (nextJob.phase === 'done') {
                        const count = (nextJob.created?.length || 0) + (nextJob.updated?.length || 0);
                        toast.success(t('llm_wiki.done_toast', '{{count}} Brain pages updated', { count }));
                        fetchPages();
                    } else {
                        toast.error(nextJob.error || t('llm_wiki.error_generic', 'Error processing the resource'));
                    }
                } catch (error) {
                    console.warn('Could not poll the background LLM Wiki job:', error);
                }
            }));
        };
        pollBackgroundJobs();
        const intervalId = setInterval(pollBackgroundJobs, 1500);
        return () => {
            alive = false;
            clearInterval(intervalId);
        };
    }, [backgroundLlmWikiJobs, fetchPages, t]);

    const fetchRegistry = useCallback(async (attempt = 0) => {
        if (attempt === 0) {
            setIsRegistryLoading(true);
        }
        try {
            const nextRegistry = await fetchVaultRegistry();
            setRegistry(nextRegistry);
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
                console.warn('Could not load canonical table snapshot, using local calculation:', snapshotErr);
            }
            return tablePages;
        } catch (err) {
            if (isAbortLikeError(err)) return [];
            logError('load-table-pages', err);
            return [];
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isAbortLikeError, resolvePageTableId, shouldIncludeTableRecord]);

    // After translating (translate-row/-rows/-page) the table needs to be refreshed.
    // But newly created pages can take a moment to become visible in
    // the backend index (indexing under OneDrive): an immediate refresh sometimes
    // returned the list WITHOUT the translations and they remained "invisible" until a
    // manual F5. Since the translation response gives us the created/
    // updated ones, we retry loading the table until they appear in it (or
    // we run out of attempts). Without ids (no creation) it does a single refresh, like before.
    const refreshTableAfterTranslate = useCallback(async (tableId, data) => {
        const expectedIds = [
            ...(data?.created || []),
            ...(data?.updated || []),
            // translate-rows (bulk) wraps each row's result inside `results`.
            ...((data?.results || []).flatMap(r => [...(r?.created || []), ...(r?.updated || [])])),
        ].map(x => x?.id).filter(Boolean);

        let pages = tableId ? await fetchPagesByTable(tableId) : [];
        // Newly created pages can take a while to become visible in the
        // backend index (indexing under OneDrive: measured up to ~10s). We retry with
        // growing backoff up to ~15s: the first attempts are fast (the
        // normal case → it stops right away) and the last ones more spaced out to cover the
        // lag without flooding it with requests. Before, it was 6×500ms=3s and it would time out.
        const backoffMs = [400, 700, 1100, 1600, 2200, 3000, 3000, 3000];
        for (const delay of backoffMs) {
            if (!expectedIds.length) break;
            const have = new Set((pages || []).map(p => p.id));
            if (expectedIds.every(id => have.has(id))) break;
            await new Promise(resolve => setTimeout(resolve, delay));
            if (tableId) pages = await fetchPagesByTable(tableId);
        }
        await fetchPages();
    }, [fetchPagesByTable, fetchPages]);

    const loadPage = useCallback(async (pageId, fromHistory = false, attempt = 0) => {
        if (!pageId) return;
        // If the wikilink passed a literal title instead of a UUID
        // (e.g. "Resum estructurat del DVA"), we now resolve it against
        // `globalIndex` or `pages`. Without this, GET /api/vault/pages/<title>
        // returns 404. globalIndex can be empty on the first load
        // if the search is immediate; that's why there's a second fallback to
        // `pages` and a third fallback to the backend (`/resolve-by-title`)
        // — this last one covers moves where globalIndex hasn't yet
        // refreshed on the frontend.
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
            // 2) Local list of pages
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
                } catch { /* ignore — we'll fall back to the standard 404 */ }
            }
            if (resolved && resolved !== pageId) {
                pageId = resolved;
            }
        }
        const tabId = pageId;
        const existingTab = tabs.find(t => t.id === tabId);
        if (existingTab) {
            const resourceType = knowledgeDocumentType(existingTab);
            if (fromHistory && nestedPath?.startsWith('page/') && resourceType === 'dashboard') {
                navigate(
                    vaultPath('knowledge', `dashboard/${encodeURIComponent(pageId)}`),
                    { replace: true },
                );
            }
            // No request in flight: we just change the focus.
            if (activeLoadAbortRef.current) {
                activeLoadAbortRef.current.abort();
                activeLoadAbortRef.current = null;
            }
            setActiveTabId(tabId);
            setViewMode('editor');
            setActiveTableId(null);
            if (!fromHistory) pushToHistory({ type: 'editor', id: pageId, resourceType });
            return;
        }

        // WARNING: if the user double-clicks the SAME wikilink, before
        // we used to abort the first loadPage and the second one would reuse the
        // requestPromise avortada → loadPage fallava silenciosament i
        // it took 2-3 more clicks for it to finally work. If the same
        // pageId is already loading, we don't abort; we let the first
        // call finishes and we exit without doing anything.
        const inFlightForSamePage = pageRequestInFlightRef.current.has(pageId);
        if (inFlightForSamePage) {
            // We wait for the result of the first call and, when it finishes,
            // setActiveTabId to ensure focus on the new page.
            try {
                const res = await pageRequestInFlightRef.current.get(pageId);
                if (res?.data) {
                    const resourceType = knowledgeDocumentType(res.data);
                    setActiveTabId(tabId);
                    setViewMode('editor');
                    setActiveTableId(null);
                    if (!fromHistory) pushToHistory({ type: 'editor', id: pageId, resourceType });
                }
            } catch { /* the first call will already report errors */ }
            return;
        }

        // We only abort if the previous load was for a DIFFERENT pageId
        // (the user has changed target). For the same pageId we end up
        // of handling it as well.
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
            const resourceType = knowledgeDocumentType(pageData);
            if (fromHistory && nestedPath?.startsWith('page/') && resourceType === 'dashboard') {
                navigate(
                    vaultPath('knowledge', `dashboard/${encodeURIComponent(pageId)}`),
                    { replace: true },
                );
            }
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
            if (!fromHistory) pushToHistory({ type: 'editor', id: pageId, resourceType });
        } catch (err) {
            if (controller.signal.aborted || isAbortLikeError(err)) {
                // Aborted by a newer loadPage — silent, not a real error.
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
    }, [fetchPageById, fetchPagesByTable, isAbortLikeError, navigate, nestedPath, pushToHistory, resolvePageTableId, tabs]);

    const openRecordFromView = useCallback((pageId, tableId, viewId, openContext = null) => {
        const sourceRecordId = openContext?.returnFocusId;
        if (sourceRecordId && tableId) {
            recordReturnFocusSequenceRef.current += 1;
            consumedRecordReturnFocusRef.current = null;
            setRecordReturnFocus({
                recordId: sourceRecordId,
                tableId,
                viewId: viewId || null,
                requestId: recordReturnFocusSequenceRef.current,
                isArmed: false,
            });
        }
        return loadPage(pageId);
    }, [loadPage]);

    const handleRecordFocusRestored = useCallback((requestId) => {
        consumedRecordReturnFocusRef.current = requestId;
    }, []);

    const handleUpdateNote = useCallback(async (id, data) => {
        try {
            await axios.patch(`/api/vault/pages/${id}`, data);
            await fetchPages();
            const page = pages.find(p => p.id === id);
            const tableIdOfPage = resolvePageTableId(page);
            if (tableIdOfPage) await fetchPagesByTable(tableIdOfPage);
        } catch (err) {
            notifyError('update-note', err, t('errors.save_note'));
            // Rethrow so optimistic callers (kanban/timeline) can revert their
            // move — otherwise a failed PATCH leaves the card stuck in the
            // destination column with the backend still holding the old value.
            throw err;
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fetchPages, fetchPagesByTable, pages, resolvePageTableId]);

    // Moves a wiki page under a new parent (drag & drop in the sidebar).
    // If newParentId is null, the page becomes root.
    const handleMovePage = useCallback(async (pageId, newParentId) => {
        if (!pageId) return;
        if (pageId === newParentId) return;
        // Optimistic update of local state: the sidebar immediately reflects
        // the change while the PATCH is in flight.
        setPages(prev => prev.map(p => p.id === pageId
            ? { ...p, parent_id: newParentId, metadata: { ...(p.metadata || {}), parent_id: newParentId } }
            : p
        ));
        try {
            await axios.patch(`/api/vault/pages/${pageId}`, {
                parent_id: newParentId,
                metadata: { parent_id: newParentId },
            });
            toast.success(t('success.page_moved', "Page moved"));
            void fetchPages();
            // Refreshes globalIndex so title-based wikilinks keep
            // resolving correctly (idToTitle is used in BlockEditor without
            // automatic re-fetch). Without this, after a move it can remain
            // stale until the next load.
            void fetchGlobalIndex();
        } catch (err) {
            notifyError('move-page', err, t('errors.move_page'));
            // Roll back optimistic update on error
            void fetchPages();
        }
    }, [fetchPages, t]);

    // Canonical definition of a table's main view: plain table, no filters or
    // grouping, sorted by the canonical `title` field, and all of the table's
    // fields visible. It mirrors the field configuration — the main view is
    // how you browse the raw table, so it must show everything.
    const buildMainViewBody = useCallback((tableId) => {
        const table = registry.tables?.find(t => t.id === tableId);
        const propNames = (table?.properties || []).map(p => p.name).filter(Boolean).filter(n => n !== 'title');
        const sort = { field: 'title', direction: 'asc' };
        return {
            name: table?.name || MAIN_VIEW_NAME,
            type: 'table',
            sort,
            sorts: [{ ...sort }],
            filters: [],
            filter: null,
            filterTree: null,
            groupBy: null,
            group_by: null,
            groupSort: null,
            group_sort: null,
            groupSortDir: 'asc',
            group_sort_dir: 'asc',
            visibleProperties: ['title', ...propNames],
            is_main: true,
        };
    }, [registry.tables]);

    const ensureMainViewForTable = useCallback((tableViews = [], tableId = null) => {
        if (!Array.isArray(tableViews) || tableViews.length === 0) {
            return [{
                id: 'default',
                table_id: tableId,
                ...buildMainViewBody(tableId),
            }];
        }

        return tableViews.map(v => {
            if (!isProtectedMainView(v)) {
                return { ...v, is_main: isMainView(v, tableViews) };
            }
            return {
                ...v,
                ...buildMainViewBody(tableId),
                id: v.id,
                table_id: v.table_id || tableId,
                is_main: true,
            };
        });
    }, [buildMainViewBody]);

    // One-time migration: when a table is opened, if its main view doesn't
    // match the canonical definition (type=table, no filters, sort by title),
    // rewrite every relevant setting, including `visibleProperties`, so the
    // main view cannot drift after an import or an old client update. Guarded by
    // viewCreationInProgressRef to avoid concurrent migrations of the same
    // table and skipped while the registry is still loading.
    const migrateMainViewForTable = useCallback((tableId) => {
        if (!tableId) return;
        const tableViews = registry.views?.filter(v => v.table_id === tableId) || [];
        const mainView = tableViews.find(v => isMainView(v, tableViews));
        if (!mainView || mainView.id === 'default') return; // virtual, not persisted
        const canonical = buildMainViewBody(tableId);
        const needsMigration = Object.entries(canonical).some(([key, value]) =>
            JSON.stringify(mainView[key]) !== JSON.stringify(value)
        );
        if (!needsMigration) return;
        if (viewCreationInProgressRef.current.has(`migrate-${tableId}`)) return;
        viewCreationInProgressRef.current.add(`migrate-${tableId}`);
        updateVaultView(mainView.id, {
            ...mainView,
            ...canonical,
            id: mainView.id,
            table_id: tableId,
        })
            .then(() => fetchRegistry())
            .catch(err => console.error("Error migrating main view:", err))
            .finally(() => viewCreationInProgressRef.current.delete(`migrate-${tableId}`));
    }, [buildMainViewBody, registry.views, fetchRegistry]);

    const getTableViews = useCallback((tableId) => {
        const persisted = registry.views?.filter(v => v.table_id === tableId) || [];
        const localOnly = views.filter(v => v.table_id === tableId && !persisted.find(pv => pv.id === v.id));
        const allViews = [...persisted, ...localOnly];
        // Returns all views (including embedded/dashboard ones). VaultViewsHeader filters
        // visible tab strip views using isViewHidden, but keeps all views in the "+" management panel
        // so users can manage and unhide dashboard views as table tabs.
        return ensureMainViewForTable(allViews, tableId);
    }, [registry.views, views, ensureMainViewForTable]);

    // The dashboard can render a virtual main view while an older table is
    // being migrated to the registry. Keep that same fallback visible in the
    // sidebar so the table's main view and navigation entry do not disappear.
    const sidebarViews = [
        ...(registry.views || []),
        ...(registry.tables || [])
            .filter(table => {
                const tableViews = (registry.views || []).filter(view => view.table_id === table.id);
                return !tableViews.some(view => isMainView(view, tableViews));
            })
            .map(table => ({
                id: 'default',
                table_id: table.id,
                ...buildMainViewBody(table.id),
            })),
    ];

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
            console.error("Error loading global index:", err);
        }
        // The alias index is secondary: if it fails, title-based wikilinks
        // keep working (and `[[alias]]` still resolves via /resolve-by-title).
        try {
            const aliasRes = await axios.get('/api/vault/alias-index');
            setAliasIndex(aliasRes.data || {});
        } catch (err) {
            console.warn("Error loading alias index:", err?.message || err);
        }
    };

    const handleUpdateView = async (updatedView) => {
        if (!updatedView || !updatedView.id) return;
        // Never persist the virtual main view: its id is the literal 'default'
        // (from ensureMainViewForTable), and PUTting it upserts a registry view
        // whose id collides across tables — a later save on another table then
        // overwrites the first table's entry. A real saved view has a unique id.
        if (updatedView.id === 'default') return;
        try {
            const tableId = updatedView.table_id || activeTableId;
            const tableViews = getTableViews(tableId);
            const main = isMainView(updatedView, tableViews);
            // The main view no longer rewrites `visibleProperties` on every
            // the schema on save: this was silently destroying the field config
            // of the main views (e.g. those imported from Notion) when
            // first change of order or column width. Now every view
            // preserve and respect its configured fields.
            let newVisible = updatedView.visibleProperties;
            const originalView = registry.views?.find(v => v.id === updatedView.id);
            if (newVisible && Array.isArray(newVisible) && newVisible.every(c => typeof c === 'string') && originalView && Array.isArray(originalView.visibleProperties) && originalView.visibleProperties.some(c => typeof c === 'object')) {
                newVisible = newVisible.map(k => originalView.visibleProperties.find(c => c.fieldKey === k) || { tableId: tableId, fieldKey: k });
                updatedView = { ...updatedView, visibleProperties: newVisible };
            }

            const normalizedView = main
                ? {
                    ...updatedView,
                    ...buildMainViewBody(tableId),
                    id: updatedView.id,
                    table_id: tableId,
                    is_main: true,
                }
                : {
                    ...updatedView,
                    is_main: false,
                };

            await updateVaultView(updatedView.id, normalizedView);
            await fetchRegistry();
            // Refresh current table pages to show possible new quick-entry records
            if (activeTableId) {
                await fetchPagesByTable(activeTableId);
            }
        } catch (err) {
            console.error("Error updating view:", err);
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
            // A duplicate made from the dashboard is a full-fledged tab,
            // even if the original was the main one from an embed origin (with
            // the "this" filter): without this, the copy would end up invisible.
            embedded: false,
        };
        try {
            await createVaultView(newView);
            await fetchRegistry();
            setActiveViewId(newView.id);
            toast.success(t('success.view_duplicated'));
        } catch (err) {
            console.error("Error duplicating view:", err);
            toast.error(t('errors.duplicate_view', 'Could not duplicate view'));
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
        setViewToDeleteUsage(null);
        fetchVaultViewUsage(view.id)
            .then(usage => {
                if (usage) setViewToDeleteUsage(usage);
            })
            .catch(() => {});
    };

    const executeDeleteView = async () => {
        if (!viewToDelete) return;
        try {
            await deleteVaultView(viewToDelete.id);
            await fetchRegistry();
            if (activeViewId === viewToDelete.id) {
                const remaining = (registry.views || [])
                    .filter(v => v.table_id === viewToDelete.table_id && v.id !== viewToDelete.id);
                setActiveViewId(remaining[0]?.id || 'default');
            }
            handleTabClose(viewToDelete.id);
            toast.success(t('success.view_deleted'));
        } catch (err) {
            console.error("Error deleting view:", err);
            toast.error(t('errors.delete_view'));
        } finally {
            setViewToDelete(null);
            setViewToDeleteUsage(null);
        }
    };

    const handleReorderViews = async (reorderedViews) => {
        // Persists the order via a single atomic PUT (no race condition with
        // concurrent POSTs that didn't move the registry entries).
        if (!Array.isArray(reorderedViews) || reorderedViews.length === 0) return;
        const tableId = reorderedViews[0]?.table_id;
        if (!tableId) return;
        const orderedIds = reorderedViews.map(v => v.id);
        // Optimistic UI: updates local state before the round-trip.
        setViews(reorderedViews);
        try {
            await reorderVaultViews({
                table_id: tableId,
                ordered_ids: orderedIds,
            });
            await fetchRegistry();
        } catch (err) {
            console.error("Error reordering views:", err);
            toast.error(t('errors.reorder_views', "Error reordering views"));
            await fetchRegistry();
        }
    };

    const handleSetViewHidden = async (targetView, hidden) => {
        const viewId = typeof targetView === 'string' ? targetView : targetView?.id;
        if (!viewId) return;
        const tableId = (typeof targetView === 'object' ? targetView.table_id : null) || activeTableId;
        const tableViews = getTableViews(tableId);
        const view = tableViews.find(v => v.id === viewId);
        if (!view) return;
        // The main view is never hidden: there must always remain one anchor tab.
        if (isMainView(view, tableViews)) {
            toast.error(t('errors.hide_main_view', "The main view cannot be hidden"));
            return;
        }
        // If we hide the active view, we jump to the first visible one (or to the main one).
        if (hidden && activeViewId === viewId) {
            const fallback = tableViews.find(v => v.id !== viewId && !isViewHidden(v, tableViews))
                || tableViews.find(v => isMainView(v, tableViews));
            if (fallback) setActiveViewId(fallback.id);
        }
        try {
            await updateVaultView(viewId, { ...view, hidden });
            await fetchRegistry();
        } catch (err) {
            console.error("Error changing view visibility:", err);
            toast.error(t('errors.save_view'));
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

    const isCreatingNoteRef = useRef(false);
    const handleAddNewNote = useCallback(async (tableId, templateId = null) => {
        if (isCreatingNoteRef.current) return;
        isCreatingNoteRef.current = true;
        try {
            const normalizedTemplateId = typeof templateId === 'string' ? templateId : null;
            let initialContent = "";
            let initialMeta = { table_id: tableId, database_table_id: tableId };
            let title = "Nou";

            if (normalizedTemplateId) {
                const templateData = await fetchVaultPage(normalizedTemplateId);
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
                    const templateData = await fetchVaultPage(defaultTemplate.id);
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

            const created = await createVaultPage({
                title: title,
                content: initialContent,
                is_database: false,
                metadata: initialMeta
            });

            const newId = created?.id;
            if (newId) {
                const newPageObj = {
                    id: newId,
                    title: title,
                    content: initialContent,
                    metadata: initialMeta,
                    last_modified: new Date().toISOString()
                };
                setPages(prev => [newPageObj, ...prev.filter(p => p.id !== newId)]);
                setGlobalIndex(prev => ({ ...prev, [newId]: title }));
                loadPage(newId);
            }
            await fetchPages();
            toast.success(t('success.record_created'));
        } catch (err) {
            console.error("Error creating the record:", err);
            toast.error(t('errors.record_create'));
        } finally {
            isCreatingNoteRef.current = false;
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tableTemplates, fetchPages, loadPage]);

    // Creates a record from the metadata suggested by a lookup
    // (DOI/ISBN/arXiv/PMID/URL/PDF). The `suggested` already includes `Citation Key`;
    // moreover, the backend guarantees it in `create_page` if it were missing. Opens the new entry.
    const handleCreateFromSource = useCallback(async (tableId, suggested) => {
        if (!tableId) return;
        try {
            const sug = suggested || {};
            const title = (sug.Title || sug.title || t('common.new')).toString();
            const tableTemplates = pages.filter((page) => (
                resolvePageTableId(page) === tableId && page.metadata?.is_template
            ));
            const template = selectResourceTemplate(tableTemplates, sug);
            let initialContent = '';
            let initialMeta = {
                ...sug,
                is_template: false,
                table_id: tableId,
                database_table_id: tableId,
                id: undefined,
            };
            if (template) {
                const templateData = await fetchVaultPage(template.id);
                initialContent = templateData.content || '';
                initialMeta = {
                    ...templateData.metadata,
                    ...initialMeta,
                    is_template: false,
                    table_id: tableId,
                    database_table_id: tableId,
                    id: undefined,
                };
            }
            initialMeta = applySchemaDefaults(tableId, initialMeta, title);
            const created = await createVaultPage({
                title,
                content: initialContent,
                is_database: false,
                metadata: initialMeta,
            });
            await fetchPages();
            toast.success(t('success.record_created'));
            loadPage(created.id);
        } catch (err) {
            console.error("Error creating the record from a source:", err);
            toast.error(t('errors.record_create', { defaultValue: "Error creating the record" }));
        }
    }, [applySchemaDefaults, fetchPages, loadPage, pages, resolvePageTableId, t]);


    // Daily Notes (Obsidian style): opens (or creates) the daily note for a date.
    // The date is computed in the client's LOCAL TIME so the "today" note
    // matches the user's day regardless of the server's time zone.
    const handleOpenDailyNote = useCallback(async (dateStr) => {
        try {
            let date = dateStr;
            if (!date) {
                const now = new Date();
                date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
            }
            const note = await openDailyNote({ date });
            await fetchPages();
            loadPage(note.id);
        } catch (err) {
            console.error('Error opening the daily note:', err);
            toast.error(t('errors.daily_note', { defaultValue: "Error opening the daily note" }));
        }
    }, [fetchPages, loadPage, t]);

    // `fetch`-style adapter over axios for PageViewModal (which expects
    // `apiFetch(url, {method, headers, body}) -> JSON`).
    const viewModalApiFetch = useCallback(async (url, opts = {}) => {
        const method = (opts.method || 'GET').toUpperCase();
        const data = opts.body ? JSON.parse(opts.body) : undefined;
        const res = await axios({ url, method, data });
        return res.data;
    }, []);

    const onViewConfigSavedRef = useRef(null);

    // callback invoked when user wants to configure an existing or new view
    const handleConfigureView = useCallback((view, onSaved) => {
        onViewConfigSavedRef.current = onSaved;
        setViewToConfigure(view);
        setIsViewConfigOpen(true);
        // if view is an existing one, pendingView remains null
    }, []);

    const handleAddView = (type) => {
        // Templates follow the prompt flow (they are not a view).
        if (type === 'template') {
            setPromptModal({
                isOpen: true,
                defaultTitle: t('common.new_template'),
                parentId: null,
                isDatabase: false,
                isDrawing: false,
                isView: false,
                isTemplate: true,
                inputValue: '',
                isLoading: false
            });
            return;
        }
        // Normal view: opens the PageViewModal to create the view directly.
        handleConfigureView({ type: type || 'table', name: '' });
    };

    useEffect(() => {
        fetchPages();
        fetchRegistry();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Abort all pending requests when the component unmounts
    // (avoid "setState on unmounted component" warnings and memory leaks).
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

    // Synchronize the URL with internal state.
    useEffect(() => {
        if (!registry.tables) return;

        // Root /vault (e.g. browser back all the way to the start): returns to the
        // home screen instead of leaving the previous content stuck.
        // (setState bails out if the value doesn't change → it doesn't trigger re-renders.)
        if (!nestedPath) {
            setActiveTabId(null);
            setActiveTableId(null);
            setViewMode('editor');
            return;
        }

        const parts = nestedPath.split('/');
        // Cases: table/:id, table/:id/view/:id, page/:id, dashboard/:id,
        // drawing/:id, and the legacy view/:id alias.
        if (parts[0] === 'table' && parts[1]) {
            const tableId = parts[1];
            const viewId = parts[3]; // table/:id/view/:id
            // On a reload (Cmd+R) this effect runs before
            // /api/vault/registry resolves: registry.tables is still [] (truthy),
            // and handleTableSelect would set activeTableId but NOT the schema (the guard
            // on the registry at line ~1222 fails with an empty registry). The re-run
            // afterward, with the registry already loaded, is ignored because activeTableId
            // already matches → the schema stays {} and no column is rendered.
            // We wait for the registry to know the table so the whole selection
            // (schema + initial view) happens in a single pass.
            if (!registry.tables?.some(t => t.id === tableId)) return;
            if (activeTableId !== tableId) {
                handleTableSelect(tableId, viewId, true);
            } else if (viewId && activeViewId !== viewId) {
                setActiveViewId(viewId);
            }
        } else if ((parts[0] === 'page' || parts[0] === 'dashboard') && parts[1]) {
            const pageId = parts.slice(1).join('/');
            if (activeTabId !== pageId) {
                loadPage(pageId, true);
            }
        } else if (parts[0] === 'drawing') {
            const drawingId = parts.slice(1).join('/');
            if (drawingId) {
                setTabs(prev => (
                    prev.some(tab => tab.id === drawingId)
                        ? prev
                        : [...prev, { id: drawingId, title: t('common.untitled'), isDrawing: true }]
                ));
                setActiveTabId(drawingId);
                setActiveTableId(null);
            }
            if (viewMode !== 'drawing') setViewMode('drawing');
        } else if (parts[0] === 'view' && parts[1]) {
            // Support for existing routes like /vault/view/areas
            const id = parts[1];
            // Try to find out whether it's a table or a page
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

    // Sync tableNotes when the server snapshot updates (e.g. after a deletion)
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

    // Note import (Markdown/Obsidian) done from the command palette:
    // refreshes the page list and reports via a toast.
    useEffect(() => {
        const onImported = (e) => {
            const d = e.detail || {};
            if (d.error) {
                const importErrorMsg = t('errors.import_notes', "Error importing: {{error}}", { error: d.error });
                toast.error?.(importErrorMsg) || toast(importErrorMsg);
                return;
            }
            const n = d.imported || 0;
            fetchPages();
            try { toast(t('vault.notes_imported_to', { count: n, folder: d.folder || 'Importades' })); } catch { /* noop */ }
        };
        window.addEventListener('gnosi:imported', onImported);
        return () => window.removeEventListener('gnosi:imported', onImported);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fetchPages]);
    useEffect(() => { closePromptModalRef.current = closePromptModal; }, [closePromptModal]);

    // Keyboard listeners for Option/Alt+K and Escape. Cmd/Ctrl+K belongs to
    // the editor's link-insertion command and must keep propagating there.
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (isGlobalSearchShortcut(e)) {
                e.preventDefault();
                setIsGlobalSearchOpen(open => !open);
            }
            if (e.key === 'Escape') {
                setIsGlobalSearchOpen(false);
                setIsRecentOpen(false);
                closePromptModalRef.current?.();
            }
        };

        // The command palette can request opening global search.
        const handleOpenSearch = () => setIsGlobalSearchOpen(true);
        window.addEventListener('gnosi:open-search', handleOpenSearch);
        // … or the hierarchical tags view.
        const handleOpenTags = () => {
            if (isPluginEnabledRef.current('tags-page')) setIsTagsOpen(true);
        };
        window.addEventListener('gnosi:open-tags', handleOpenTags);
        // … or the presentation mode of the current note.
        const handlePresent = () => setIsPresentOpen(true);
        window.addEventListener('gnosi:present', handlePresent);
        // … or saved workspaces.
        const handleWorkspaces = () => setIsWorkspacesOpen(true);
        window.addEventListener('gnosi:open-workspaces', handleWorkspaces);

        const handleFolderOpen = (e) => {
            if (e.detail?.folder) {
                // Backwards compatibility for Database block clicks
                loadPageRef.current?.(e.detail.folder);
            }
        };

        // PDFs linked from a Vault page or from outside: useFileLinkInterceptor
        // fires this event with { src, title }. We cancel the default
        // so the interceptor knows we've handled it (no need to navigate to
        // /vault/pdf?src=... as a fallback).
        const handleOpenPdf = (e) => {
            const { src, title, kind, location } = e.detail || {};
            if (!src) return;
            e.preventDefault();
            // PDF / EPUB / snapshot HTML use one canonical tab id per source.
            // The `kind` field controls which specific viewer is initialized
            // inside the iframe.
            const id = documentTabId(src);
            // We remember WHERE the document is opened from so the "Back" button of the
            // viewer (and closing the tab) can return there. Without this,
            // opening a PDF from a table would make it disappear with no way
            // back ("I can't go back"). We read the mirrors (refs)
            // because this handler lives in an effect with `[]` deps.
            const origin = {
                tableId: activeTableIdRef.current,
                tabId: activeTabIdRef.current,
                viewId: activeViewIdRef.current,
            };
            setTabs(prev => {
                // If the tab already exists (reopening the same document),
                // WE REFRESH the origin to the actual place it was just reopened from;
                // otherwise, "Back" would return to the first place it was opened.
                if (prev.some(t => t.id === id)) {
                    // Reopening the same document: refresh origin AND the deep-link
                    // location so clicking a different citation re-navigates.
                    return prev.map(t => (t.id === id ? { ...t, origin, location: location || null } : t));
                }
                return [...prev, { id, title: title || t('common.document', 'document'), isPdf: true, src, kind: kind || 'pdf', origin, location: location || null }];
            });
            setActiveTabId(id);
            setViewMode('editor');
            setActiveTableId(null);
        };

        // Record in the undo stack the records deleted from a view
        // EMBEDDED (DbViewEmbed). That deletion goes through its own path (axios
        // directly) that doesn't touch this `undoStack`, so without this the
        // Cmd+Z wouldn't recover them. The embedded view emits this event with the
        // ids once the soft-delete has succeeded; here we treat it the same as a
        // deleted from the main view.
        const handleRecordsDeleted = (e) => {
            const ids = (e.detail?.ids || []).filter(Boolean);
            if (!ids.length) return;
            pendingRelationUndoRef.current = null;
            setUndoStack(prev => [...prev, { type: 'delete', ids }]);
            setRedoStack([]);
        };
        const handleRelationUnlinked = (e) => {
            const detail = e.detail || {};
            if (!detail.pageId || !detail.metadataKey || !Array.isArray(detail.previousValue) || !Array.isArray(detail.nextValue)) return;
            const operation = { type: 'relation_unlink', ...detail };
            setUndoStack(prev => [...prev, operation]);
            setRedoStack([]);
            pendingRelationUndoRef.current = async () => {
                const restored = await applyRelationHistoryValue(operation, operation.previousValue);
                if (!restored) return;
                pendingRelationUndoRef.current = null;
                setUndoStack(prev => {
                    const index = prev.lastIndexOf(operation);
                    return index < 0 ? prev : [...prev.slice(0, index), ...prev.slice(index + 1)];
                });
                setRedoStack(prev => [...prev, operation]);
                toast.success(t('relation_item.undo_success', 'Relation restored'));
            };
            toast((toastItem) => (
                <span className="flex items-center gap-3">
                    <span className="min-w-0">
                        {t('relation_item.removed_toast', 'Relation removed: {{title}}', {
                            title: detail.relationTitle || detail.relationId,
                        })}
                    </span>
                    <button
                        type="button"
                        onClick={() => {
                            toast.dismiss(toastItem.id);
                            const pendingUndo = pendingRelationUndoRef.current;
                            if (pendingUndo) void pendingUndo();
                            else undoRef.current?.();
                        }}
                        className="shrink-0 rounded bg-[var(--gnosi-primary)] px-2 py-0.5 text-xs font-semibold text-white hover:opacity-90"
                    >
                        {t('common.undo', 'Undo')}
                    </button>
                    <kbd className="shrink-0 text-[10px] text-[var(--text-tertiary)]">⌘/Ctrl+Z</kbd>
                </span>
            ), { duration: 8000 });
        };

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('vault-open-folder', handleFolderOpen);
        window.addEventListener('gnosi:open-pdf', handleOpenPdf);
        window.addEventListener('gnosi:records-deleted', handleRecordsDeleted);
        window.addEventListener(RELATION_UNLINKED_EVENT, handleRelationUnlinked);

        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('gnosi:open-search', handleOpenSearch);
            window.removeEventListener('gnosi:open-tags', handleOpenTags);
            window.removeEventListener('gnosi:present', handlePresent);
            window.removeEventListener('gnosi:open-workspaces', handleWorkspaces);
            window.removeEventListener('vault-open-folder', handleFolderOpen);
            window.removeEventListener('gnosi:open-pdf', handleOpenPdf);
            window.removeEventListener('gnosi:records-deleted', handleRecordsDeleted);
            window.removeEventListener(RELATION_UNLINKED_EVENT, handleRelationUnlinked);
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Global Undo/Redo shortcuts (using refs to avoid stale closures)
    useEffect(() => {
        const handleUndoRedo = (e) => {
            if (!(e.metaKey || e.ctrlKey)) return;
            const tag = document.activeElement?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;
            // With Shift, e.key arrives uppercase ('Z'); we normalize it.
            const key = String(e.key || '').toLowerCase();
            if (key === 'z' && !e.shiftKey) {
                const pendingUndo = pendingRelationUndoRef.current;
                if (pendingUndo) {
                    e.preventDefault();
                    void pendingUndo();
                    return;
                }
                // We only hijack the shortcut if there REALLY is a table operation
                // to undo. Otherwise, we let the event propagate so the editor (or the
                // browser) can handle it — previously it swallowed the undo of
                // the editor when focus was outside the contenteditable.
                if (undoStackLenRef.current === 0) return;
                e.preventDefault();
                undoRef.current?.();
            } else if ((key === 'z' && e.shiftKey) || key === 'y') {
                if (redoStackLenRef.current === 0) return;
                e.preventDefault();
                redoRef.current?.();
            }
        };
        window.addEventListener('keydown', handleUndoRedo);
        return () => window.removeEventListener('keydown', handleUndoRedo);
    }, []);

    const handleTableSelect = useCallback(async (tableId, viewId = null, fromHistory = false) => {
        // If a table tab is already open, switch focus to it
        const existingTableTab = tabs.find(t => t.isTable && getTableIdFromTab(t) === tableId);
        if (existingTableTab) {
            if (!fromHistory) pushToHistory({ type: 'table', id: tableId, subId: viewId });
            setActiveTabId(existingTableTab.id);
            setActiveTableId(tableId);
            setViewMode('editor');
            if (viewId) setActiveViewId(viewId);
            return;
        }
        // If the table is already the active inline view and there's no view change, do nothing
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
            createVaultView({
                id: defaultId,
                table_id: tableId,
                ...buildMainViewBody(tableId),
            }).then(() => fetchRegistry()).catch(err => console.error("Error auto-creating view:", err))
              .finally(() => viewCreationInProgressRef.current.delete(tableId));
        } else if (!isRegistryLoading && Array.isArray(registry.views) && tableViews.length > 0) {
            // Migrate an existing main view to the canonical definition.
            migrateMainViewForTable(tableId);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pushToHistory, setActiveTableId, setViewMode, setActiveTabId, resolvePageTableId, getTableVisibleRecords, setTableNotes, pages, setTableTemplates, fetchPagesByTable, registry.tables, registry.views, getSchemaFromTableId, setViews, setActiveViewId, getPreferredInitialViewId, fetchRegistry, tabs, getTableIdFromTab, activeTableId]);

    const returnToTableFromBreadcrumb = useCallback((tableId, viewId = null) => {
        setRecordReturnFocus(current => {
            if (!current || current.tableId !== tableId) return current;
            return { ...current, isArmed: true };
        });
        return handleTableSelect(tableId, viewId);
    }, [handleTableSelect]);

    const handleEditorUpdate = useCallback((pageId, content, payload = {}) => {
        setTabs(prevTabs => prevTabs.map(tab => {
            if (tab.id !== pageId) return tab;

            // If `content` is `undefined`, the editor has only updated
            // metadata (e.g. renaming the title via panel or header). We keep
            // the existing content — without this fallback, we used to lose the body
            // of the tab every time the page was renamed.
            return {
                ...tab,
                content: content !== undefined ? content : tab.content,
                title: payload?.title ?? tab.title,
                metadata: payload?.metadata ?? tab.metadata,
            };
        }));

        // Propagates the change to the global `pages` state and to the cache
        // `visibleTableRecordsById` so that, when returning to a view (Table,
        // Gallery, Kanban, Feed) after closing the tab, you see
        // the new title/metadata/content immediately without having to do a
        // manual refresh. Without this, the view reads from the previous cache and
        // shows stale data until the next `fetchPages`.
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
        setTableNotes(prev => prev.map(p => p.id === pageId ? applyPatch(p) : p));
        if (nextTitle !== undefined) {
            setGlobalIndex(prev => ({ ...prev, [pageId]: nextTitle }));
        }
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
                title: res.data.title || t('common.untitled'),
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
            const closingTab = prevTabs.find(t => t.id === tabId);
            const remainingTabs = prevTabs.filter(t => t.id !== tabId);

            setSplitTabIds(prevSplit => {
                const remainingSplitTabIds = prevSplit.filter(id => id !== tabId);

                if (activeTabId === tabId) {
                    // If we close a document (PDF/EPUB) that remembers where it was
                    // opened from, we return there instead of the generic "last
                    // tab" fallback — it's the "go back" the user expected.
                    const origin = closingTab?.origin;
                    if (origin && (origin.tableId || origin.tabId)) {
                        if (origin.tabId && remainingTabs.some(tab => tab.id === origin.tabId)) {
                            const ot = remainingTabs.find(tab => tab.id === origin.tabId);
                            setActiveTabId(origin.tabId);
                            setActiveTableId(ot?.isTable ? getTableIdFromTab(ot) : null);
                            setViewMode(ot?.isDrawing ? 'drawing' : 'editor');
                            return remainingSplitTabIds.filter(id => id !== origin.tabId);
                        }
                        if (origin.tableId) {
                            // handleTableSelect fixa activeTableId/viewMode i
                            // sets activeTabId=null by itself. fromHistory=true:
                            // going back should not add a new entry to
                            // the history (the URL is already that of the origin table).
                            handleTableSelect(origin.tableId, origin.viewId || null, true);
                            // We go to the inline table view, which does NOT render
                            // split panels: we clear splitTabIds so as not to
                            // leaving them orphaned (invisible until you go back to
                            // an editor).
                            return [];
                        }
                    }
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
        // Don't filter tabs while the global data is still loading.
        // Without this guard, opening the dashboard with a direct URL
        // /vault/page/<id> was closing the tab that loadPage had just opened
        // (because `pages` was still [] when the effect ran) and the dashboard
        // would fall back to "Welcome" instead of showing the requested page.
        if (loading || isRegistryLoading) return;

        const existingPageIds = new Set(pages.map(page => page.id));
        const existingTableIds = new Set((registry.tables || []).map(table => table.id));

        setTabs(prevTabs => {
            const filteredTabs = prevTabs.filter(tab => {
                if (tab.isTable) {
                    const tableId = getTableIdFromTab(tab);
                    return Boolean(tableId && existingTableIds.has(tableId));
                }
                // PDF and drawings tabs don't live in the `pages` registry —
                // are "volatile" tabs that the session keeps in memory.
                // They shouldn't be filtered because they're not part of the catalog.
                if (tab.isPdf || tab.isDrawing) return true;
                // Don't close active tabs or tabs with loaded content if they are not in existingPageIds yet
                // (e.g. freshly created pages whose index/fetchPages is still propagating)
                if (tab.id === activeTabId || tab.content !== undefined) return true;
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

    // Replaces the active tab with the destination page (browser "same tab" semantics).
    // If the destination page is already the active one, it does nothing.
    // If there's no active tab, it's equivalent to `loadPage` (add + focus).
    const handleOpenInCurrentTab = useCallback(async (pageId) => {
        if (!pageId) return;
        if (pageId === activeTabId) return;

        const previousTabId = activeTabId;

        await loadPage(pageId);

        // Closes the previous tab only if it still exists and hasn't been promoted to the new one.
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
            toast.error(t('errors.record_create'));
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
                createVaultView({
                    id: defaultId,
                    table_id: tableId,
                    ...buildMainViewBody(tableId),
                }).then(() => fetchRegistry()).catch(err => console.error("Error auto-creating view:", err))
                  .finally(() => viewCreationInProgressRef.current.delete(tableId));
            } else if (!isRegistryLoading && Array.isArray(registry.views) && tableViews.length > 0) {
                migrateMainViewForTable(tableId);
            }
        } catch (err) {
            console.error("Error opening the table:", err);
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
            // PDF tabs don't go into the navigation history (they have no canonical route
            // within the Vault) — they're session-only. Reacts to opening them
            // again with the same link.
            pushToHistory({
                type: 'editor',
                id: tabId,
                resourceType: knowledgeDocumentType(tab),
            });
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
        const { inputValue, parentId, isDatabase, isDrawing, isDashboard, isRename, isTemplate, templateTableId, isApp, databaseId } = promptModal;
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
                        table_id: templateTableId || activeTableId,
                        database_table_id: templateTableId || activeTableId
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
                        ...buildMainViewBody(view.table_id || activeTableId),
                        id: uuidv4(),
                        table_id: view.table_id || activeTableId,
                        name: title,
                        order: 0,
                    };
                    await createVaultView(newView);
                    setActiveViewId(newView.id);
                } else {
                    await updateVaultView(viewId, updated);
                }
                await fetchRegistry();
                toast.success(t('success.view_renamed'));
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
                pushToHistory({ type: 'drawing', id: drawingId });
            } else if (isDatabase && databaseId) {
                // Table inside a Database (App)
                const tableRes = await axios.post('/api/vault/tables', {
                    name: title,
                    database_id: databaseId,
                    locale: i18n.resolvedLanguage || i18n.language,
                    properties: [{ name: "Status", type: "select" }]
                });
                await createVaultView({
                    id: uuidv4(),
                    table_id: tableRes.data.id,
                    ...buildMainViewBody(tableRes.data.id),
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
            toast.error(t('errors.create_content'));
            setPromptModal(prev => ({ ...prev, isLoading: false }));
        }
    };

    // ---- INDIVIDUAL DELETION (soft-delete + toast with "Undo") ----
    // Soft-delete: the backend moves the page to `.trash/{id}/`. It can be restored
    // from the toast (for a few seconds) or from the trash view.
    // Vegeu docs/dev_memory/directives/vault_trash.md.
    const handleDeletePage = useCallback(async (pageId, pageTitle) => {
        if (!pageId) return;
        const id = pageId;
        const title = pageTitle || t('common.untitled', "Untitled");

        const removeFromState = () => {
            window.dispatchEvent(new CustomEvent('gnosi:page-deleted', {
                detail: { pageId: id },
            }));
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
                // We return to the tab that `handleTabClose` has promoted (typically
                // the dashboard or parent table it had been opened from
                // the entry), instead of falling back to `/vault` (the "Hola" screen
                // empty) and leave the user without context.
                const remaining = tabs.filter(tab => tab.id !== id);
                const fallback = remaining[remaining.length - 1];
                if (fallback?.isDrawing) {
                    pushToHistory({ type: 'drawing', id: fallback.id });
                } else if (fallback?.isTable) {
                    const tableId = getTableIdFromTab(fallback);
                    if (tableId) pushToHistory({ type: 'table', id: tableId });
                    else navigate(vaultPath('knowledge'));
                } else if (fallback) {
                    pushToHistory({
                        type: 'editor',
                        id: fallback.id,
                        resourceType: knowledgeDocumentType(fallback),
                    });
                } else {
                    navigate(vaultPath('knowledge'));
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
                toast.success(t('success.page_restored'));
            } catch (err) {
                console.error('Error restoring the page:', err);
                toast.error(t('errors.restore_page'));
            }
        };

        try {
            await axios.delete(`/api/vault/pages/${id}`);
            removeFromState();
            refreshAfterDelete();
            toast((tObj) => (
                <span className="flex items-center gap-3">
                    <span className="truncate max-w-[16rem]">
                        "{title}" {t('vault.moved_to_trash')}
                    </span>
                    <button
                        type="button"
                        onClick={async () => {
                            toast.dismiss(tObj.id);
                            await restorePage();
                        }}
                        className="px-2 py-0.5 rounded text-xs font-semibold bg-[var(--gnosi-primary)] text-white hover:opacity-90"
                    >
                        {t('common.undo', "Undo")}
                    </button>
                </span>
            ), { duration: 8000 });
        } catch (err) {
            // 404: it's no longer on disk; local cleanup and a ghost warning.
            if (err?.response?.status === 404) {
                removeFromState();
                refreshAfterDelete();
                toast.success(t('success.page_deleted_ghost', "Page deleted (ghost cache entry)"));
            } else {
                console.error('Error moving the page to trash:', err);
                toast.error(t('errors.delete_page', "Error deleting page"));
            }
        }
    }, [nestedPath, navigate, handleTabClose, fetchPages, fetchPagesByTable, activeTableId, t, tabs, pushToHistory]);

    // ---- DELETE MULTIPLE RECORDS (soft-delete + toast with "Undo") ----
    // No modal: the delete is reversible from the toast (8 s), from Cmd+Z,
    // or from the trash view. Partial errors (some 4xx/5xx) are
    // are shown separately, so we don't mislead the user with a "done" when it isn't.
    const handleDeleteSelected = useCallback(async (selectedIds) => {
        const idArray = [...selectedIds];
        if (idArray.length === 0) return;

        const refreshAfter = () => {
            if (activeTableId) void fetchPagesByTable(activeTableId);
            else void fetchPages();
        };
        // Restore with partial error reporting. Returns {succeeded, failed}.
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
                toast.success(t('vault.records_restored', { count: succeeded.length }));
            }
            if (failed.length > 0) {
                const reasons = failed.map(f => f.status || '?').join(', ');
                toast.error(t('vault.records_restore_failed', { count: failed.length, reasons }));
            }
            return { succeeded, failed };
        };

        // DELETE: 404 → treated as success (it's no longer on disk; it still needs to be removed from
        // local state anyway); 200/2xx → success; anything else → failed.
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

        // Optimistic update only for confirmed ids.
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
            toast.error(t('vault.records_delete_failed', { count: failedDeletes.length, reasons }));
        }

        if (deletedIds.length === 0) return;

        const count = deletedIds.length;
        toast((tObj) => (
            <span className="flex items-center gap-3">
                <span>
                    {t('vault.records_trashed', { count })}
                </span>
                <button
                    type="button"
                    onClick={async () => {
                        toast.dismiss(tObj.id);
                        await restoreMany(deletedIds);
                    }}
                    className="px-2 py-0.5 rounded text-xs font-semibold bg-[var(--gnosi-primary)] text-white hover:opacity-90"
                >
                    {t('common.undo')}
                </button>
            </span>
        ), { duration: 8000 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fetchPages, fetchPagesByTable, activeTableId, handleTabClose]);

    const handleApplyTemplate = useCallback(async (selectedIds, templateId, tableId) => {
        const pageIds = [...selectedIds];
        if (pageIds.length === 0 || !templateId) return;
        try {
            const response = await axios.post('/api/vault/bulk-apply-template', {
                page_ids: pageIds,
                template_id: templateId,
            });
            const updated = response.data?.updated || 0;
            const failed = (response.data?.errors?.length || 0) + (response.data?.conflicts?.length || 0);
            if (updated > 0) {
                toast.success(t('bulk_actions.template_applied', { count: updated }));
                await fetchPagesByTable(tableId);
            }
            if (failed > 0) toast.error(t('bulk_actions.template_apply_partial_error', { count: failed }));
        } catch (error) {
            console.error('Could not apply template to selected records:', error);
            toast.error(t('bulk_actions.template_apply_error'));
        }
    }, [fetchPagesByTable, t]);

    const applyRelationHistoryValue = useCallback(async (operation, value) => {
        const applyLocalValue = (localValue) => {
            const patchPage = (page) => (
                page.id === operation.pageId
                    ? { ...page, metadata: { ...(page.metadata || {}), [operation.metadataKey]: localValue } }
                    : page
            );
            setTabs(prev => prev.map(patchPage));
            setPages(prev => {
                const next = prev.map(patchPage);
                pagesRef.current = next;
                return next;
            });
            setTableNotes(prev => prev.map(patchPage));
            setVisibleTableRecordsById(prev => {
                let changed = false;
                const next = {};
                for (const [tableId, records] of Object.entries(prev || {})) {
                    if (!Array.isArray(records)) {
                        next[tableId] = records;
                        continue;
                    }
                    const patched = records.map(patchPage);
                    if (patched.some((record, index) => record !== records[index])) changed = true;
                    next[tableId] = patched;
                }
                return changed ? next : prev;
            });
            window.dispatchEvent(new CustomEvent(RELATION_VALUE_APPLIED_EVENT, {
                detail: {
                    pageId: operation.pageId,
                    metadataKey: operation.metadataKey,
                    value: localValue,
                },
            }));
        };
        const isUndoValue = JSON.stringify(value) === JSON.stringify(operation.previousValue);
        const rollbackValue = isUndoValue ? operation.nextValue : operation.previousValue;
        applyLocalValue(value);

        try {
            await axios.patch(`/api/vault/pages/${encodeURIComponent(operation.pageId)}`, {
                metadata: { [operation.metadataKey]: value },
            });

            // A relation unlink starts its own background refresh. Undo can
            // overtake that request, whose stale response would otherwise repaint
            // the removed value after the optimistic restoration. Refresh again
            // after the older request has had time to settle.
            void fetchPages();
            if (activeTableId) void fetchPagesByTable(activeTableId);
            window.setTimeout(() => {
                void fetchPages();
                if (activeTableId) void fetchPagesByTable(activeTableId);
            }, 1800);
            window.setTimeout(() => {
                void fetchPages();
                if (activeTableId) void fetchPagesByTable(activeTableId);
            }, 3600);
            return true;
        } catch (error) {
            applyLocalValue(rollbackValue);
            notifyError(
                'relation-history',
                error,
                t('relation_item.history_error', 'Could not restore the relation change'),
            );
            return false;
        }
    }, [activeTableId, fetchPages, fetchPagesByTable, t]);

    // ---- DESFER (Undo) — restaurar la darrera tongada eliminada ----
    // If all restores fail, we don't move the operation to redoStack: we
    // keep it in undoStack to allow retries. If the failure is partial,
    // we do clean up (the ones that did come back can no longer be undone again).
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
                toast.success(t('vault.records_restored', { count: succeeded.length }));
            }
            if (failed.length > 0) {
                const reasons = failed.map(f => f.status || '?').join(', ');
                toast.error(t('vault.records_restore_failed', { count: failed.length, reasons }));
            }

            if (succeeded.length === 0) {
                // No restoration: we keep the operation in undoStack for a retry.
                return;
            }
            // If partial, only the succeeded ones are candidates for "redo" — the
            // rest can no longer be deleted because it might already be.
            setRedoStack(prev => [...prev, { type: 'delete', ids: succeeded }]);
        } else if (operation.type === 'relation_unlink') {
            const restored = await applyRelationHistoryValue(operation, operation.previousValue);
            if (!restored) return;
            toast.success(t('relation_item.undo_success', 'Relation restored'));
            setRedoStack(prev => [...prev, operation]);
        } else {
            setRedoStack(prev => [...prev, operation]);
        }

        setUndoStack(prev => prev.slice(0, -1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [undoStack, fetchPages, fetchPagesByTable, activeTableId, applyRelationHistoryValue, t]);

    // ---- REFER (Redo) — move back to trash ----
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
                toast.success(t('vault.records_redeleted', { count: succeeded.length }));
            }
            if (failed.length > 0) {
                const reasons = failed.map(f => f.status || '?').join(', ');
                toast.error(t('vault.records_redelete_failed', { count: failed.length, reasons }));
            }

            if (activeTableId) void fetchPagesByTable(activeTableId);
            else void fetchPages();

            if (succeeded.length === 0) return;

            setUndoStack(prev => [...prev, { type: 'delete', ids: succeeded }]);
        } else if (operation.type === 'relation_unlink') {
            const reapplied = await applyRelationHistoryValue(operation, operation.nextValue);
            if (!reapplied) return;
            toast.success(t('relation_item.redo_success', 'Relation removed again'));
            setUndoStack(prev => [...prev, operation]);
        } else {
            setUndoStack(prev => [...prev, operation]);
        }

        setRedoStack(prev => prev.slice(0, -1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [redoStack, pages, syncPagesState, fetchPages, fetchPagesByTable, activeTableId, handleTabClose, applyRelationHistoryValue, t]);

    // Keep refs up to date (avoids stale closures in the Cmd+Z listener)
    useEffect(() => { undoRef.current = undoLastOperation; }, [undoLastOperation]);
    useEffect(() => { redoRef.current = redoLastOperation; }, [redoLastOperation]);
    useEffect(() => { undoStackLenRef.current = undoStack.length; }, [undoStack]);
    useEffect(() => { redoStackLenRef.current = redoStack.length; }, [redoStack]);
    // We keep the active view mirrors up to date (see refs above).
    useEffect(() => { activeTableIdRef.current = activeTableId; }, [activeTableId]);
    useEffect(() => { activeTabIdRef.current = activeTabId; }, [activeTabId]);
    useEffect(() => { activeViewIdRef.current = activeViewId; }, [activeViewId]);
    useEffect(() => { viewModeRef.current = viewMode; }, [viewMode]);

    const handleDuplicatePage = useCallback(async (pageId) => {
        try {
            const res = await axios.post(`/api/vault/pages/${pageId}/duplicate`);
            toast.success(t('success.page_duplicated'));
            await fetchPages();
            loadPage(res.data.id);
        } catch {
            toast.error(t('errors.duplicate_page'));
        }
    }, [fetchPages, loadPage, t]);

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
            // Refreshes globalIndex so the new title appears in the lookup
            // title→id (pending `[[Old title]]` wikilinks will remain
            // unmatched, but `[[Nou títol]]` will resolve correctly; the
            // backend doesn't do an automatic "rewrite" of the wikilinks
            // that already exist, either; that would require a separate job).
            void fetchGlobalIndex();
            toast.success(t('success.title_updated'));
        } catch {
            toast.error(t('errors.rename_page'));
        }
    }, [fetchPages, setTabs, t]);

    const handleToggleFavorite = useCallback(async (pageId) => {
        if (!pageId) return;
        // Computes the new value from local state (it resolves faster than
        // a GET, and also serves as the basis for the optimistic patch that makes
        // the Favorites section appear right away in the sidebar without
        // waiting for the subsequent PUT + fetchPages).
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

        // 2) Persistence to the backend. We need the current content for the
        // PUT (not lose the note body); if the GET or the PUT fail,
        // we revert the optimistic update so as not to mislead the user.
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
            // We don't wait for fetchPages (it's slow on saturated networks); the
            // optimistic patch has already refreshed the UI.
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

    // Persist a new `select`/`multi_select` option to the schema of a
    // table. Called when the user types a new value into the panel's picker
    // of properties. Without this, the value only stays in the metadata of the
    // record (and ends up reappearing as an "observed option" via
    // getAvailableOptions) — it does work for display, but the
    // intent of having it as an official schema option is lost.
    const handleAddSchemaOption = useCallback(async (tableId, fieldId, nextOptions) => {
        if (!tableId || !fieldId || !Array.isArray(nextOptions)) return;
        try {
            await axios.patch(
                `/api/vault/tables/${tableId}/properties/${fieldId}`,
                { config: { options: nextOptions } }
            );
            await fetchRegistry();
        } catch (err) {
            notifyError('add-schema-option', err, t('errors.add_schema_option'));
        }
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
                onClick: () => returnToTableFromBreadcrumb(table.id, viewId)
            });
        }

        crumbs.push({
            label: table.name,
            onClick: () => returnToTableFromBreadcrumb(table.id, viewId)
        });

        return crumbs;
    };

    const buildTableContextBreadcrumbs = (page) => {
        if (!page) return [];
        const tableId = resolvePageTableId(page);
        if (!tableId) return [];
        return buildTableCrumbsByTableId(tableId);
    };

    // Builds the "container" segment of an entry's breadcrumb according to
    // the actual navigation ORIGIN (where the user opened it from), not just the
    // structural hierarchy of the table. Case tree:
    //   - origin = dashboard   -> segment toward the dashboard (returns there on click)
    //   - source = table view  -> DB / Table segment (at the exact view)
    //   - other / unknown   -> null (the caller falls back to the structural hierarchy)
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
        { label: t('common.knowledge'), onClick: () => { setActiveTabId(null); setViewMode('editor'); } }
    ];
    if (activeTabId) {
        const activePage = pages.find(p => p.id === activeTabId);
        const pageBreadcrumbs = buildPageParentBreadcrumbs(activeTabId);
        const hasParentHierarchy = pageBreadcrumbs.length > 1;

        if (!hasParentHierarchy) {
            // For a table record, prioritize the actual navigation origin
            // (dashboard or table view) and, if we don't have one, fall back to the
            // structural hierarchy of the table the record belongs to.
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
    // The active tab can exist briefly before the pages index is refreshed.
    // Keep page actions available during that window, but never expose page
    // deletion for table or PDF tabs.
    const canDeleteCurrentPage = viewMode === 'editor'
        && Boolean(currentActiveTab?.id)
        && !currentActiveTab.isTable
        && !currentActiveTab.isPdf;
    const isCodeViewActive = canToggleCodeView ? Boolean(codeViewByTabId[currentActiveTab.id]) : false;
    // Translate page: only for editable markdown pages (not tables or PDFs).
    const canTranslatePage = isPluginEnabled('translation') && viewMode === 'editor' && Boolean(currentOpenPage && currentActiveTab && !currentActiveTab.isTable && !currentActiveTab.isPdf);
    // GAP 2: if the open page is a record of a translatable table (and is not
    // itself a translation), the menu must translate the FIELDS into a submenu item
    // ('row' mode), not the body into a subpage. For normal pages, 'page' mode.
    const openPageTableId = currentOpenPage ? resolvePageTableId(currentOpenPage) : null;
    const openPageTable = openPageTableId ? registry.tables?.find(t => t.id === openPageTableId) : null;
    const openPageIsTranslatableRecord = Boolean(openPageTable?.translation_enabled)
        && !currentOpenPage?.metadata?.translation_lang;
    const llmWikiSourceConfig = (llmWikiConfig?.source_tables || []).find(
        (source) => source.table_id === openPageTableId,
    ) || null;
    useEffect(() => {
        let alive = true;
        if (!isPluginEnabled('llm-wiki') || !currentOpenPage?.id || !openPageTableId || !llmWikiSourceConfig) {
            return () => { alive = false; };
        }
        // The configuration snapshot can predate a failed job. Load the durable
        // status for the open resource so interrupted work can always be resumed.
        fetchResourceProcessingStatus(currentOpenPage.id, openPageTableId).then((job) => {
            if (!alive || job?.phase === 'idle') return;
            setLlmWikiJobs((current) => ({
                ...current,
                [openPageTableId]: {
                    ...(current[openPageTableId] || {}),
                    [currentOpenPage.id]: job,
                },
            }));
        }).catch((error) => {
            console.warn('Could not load the LLM Wiki status for the open resource:', error);
        });
        return () => { alive = false; };
    }, [currentOpenPage?.id, isPluginEnabled, llmWikiSourceConfig, openPageTableId]);
    const llmWikiResourceJob = llmWikiJobs?.[openPageTableId]?.[currentOpenPage?.id] || null;
    const llmWikiResourceRunning = Boolean(llmWikiResourceJob?.running);
    const llmWikiResourceRetryable = ['partial', 'error'].includes(llmWikiResourceJob?.phase);
    const llmWikiResourceProcessed = currentOpenPage?.metadata?.['Processat pel Cervell']
        || currentOpenPage?.metadata?.['processat pel cervell']
        || llmWikiConfig?.processed_resources?.[openPageTableId]?.[currentOpenPage?.id];
    const canProcessOpenResource = isPluginEnabled('llm-wiki')
        && Boolean(llmWikiSourceConfig)
        && !llmWikiResourceRunning;
    const llmWikiResourceLabel = llmWikiResourceRetryable
        ? t('table.reprocess_resource_error', "Resume interrupted processing")
        : !llmWikiResourceProcessed
            ? t('table.process_resource', "Process resource (Brain)")
            : t('table.reprocess_resource', "Reprocess resource (processed on {{date}})", {
                date: typeof llmWikiResourceProcessed === 'number'
                    ? new Date(llmWikiResourceProcessed * 1000).toLocaleDateString()
                    : llmWikiResourceProcessed,
            });

    // Page-level actions, formerly the VaultShell top-bar "…" menu. They now
    // render as inline icon buttons next to the page title (PageActionsBar,
    // wired through BlockEditor). The gating/handlers are unchanged — the set is
    // active-page-scoped and only the active pane's title shows the toolbar.
    const pageActions = {
        canFavorite: Boolean(currentActiveTab?.id),
        isFavorite: currentActiveTab?.metadata?.favorite === true || currentActiveTab?.metadata?.favorite === 'true',
        onToggleFavorite: () => {
            if (!currentActiveTab?.id) return;
            handleToggleFavorite(currentActiveTab.id);
        },
        canToggleEditLock: Boolean(currentActiveTab?.id) && viewMode === 'editor' && !currentActiveTab?.isPdf,
        isEditLocked: Boolean(currentActiveTab?.id && editLockedByPageId[currentActiveTab.id]),
        onToggleEditLock: () => {
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
        },
        canToggleCodeView,
        isCodeView: isCodeViewActive,
        onToggleCodeView: () => {
            if (!canToggleCodeView || !currentActiveTab?.id) return;
            setCodeViewByTabId(prev => ({
                ...prev,
                [currentActiveTab.id]: !prev[currentActiveTab.id],
            }));
        },
        canOpenHistory: Boolean(currentOpenPage),
        onOpenHistory: () => {
            if (!currentOpenPage) return;
            setHistoryOpenSignal(prev => prev + 1);
        },
        canOpenComments: Boolean(currentOpenPage) && isPluginEnabled('page-comments'),
        onOpenComments: () => {
            if (!currentOpenPage) return;
            setCommentsOpen(true);
        },
        canOpenShare: Boolean(currentOpenPage) && isPluginEnabled('share-links'),
        onOpenShare: () => {
            if (!currentOpenPage) return;
            setShareOpen(true);
        },
        canTranslatePage,
        translateLabel: openPageIsTranslatableRecord
            ? t('shell.translate_record', "Translate record")
            : t('shell.translate_page', "Translate page"),
        onTranslatePage: () => {
            if (!canTranslatePage || !currentOpenPage?.id) return;
            setTranslatePageMode(openPageIsTranslatableRecord ? 'row' : 'page');
            setTranslatePageModalId(currentOpenPage.id);
        },
        canProcessResource: canProcessOpenResource,
        processResourceLabel: llmWikiResourceLabel,
        onProcessResource: () => {
            if (!canProcessOpenResource || !currentOpenPage?.id) return;
            setResourceToProcess({
                noteId: currentOpenPage.id,
                title: currentOpenPage.title || '',
                sourceTableId: openPageTableId,
                force: Boolean(llmWikiResourceProcessed) || llmWikiResourceRetryable,
            });
        },
        canDeleteCurrentPage,
        onDeleteCurrentPage: () => {
            if (!canDeleteCurrentPage) return;
            const page = currentOpenPage || currentActiveTab;
            if (!page) return;
            handleDeletePage(page.id, page.title || t('common.untitled'));
        },
    };

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
                    title: page.title || t('common.untitled'),
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
            onOpenDaily={isPluginEnabled('daily-notes') ? handleOpenDailyNote : null}
            showTagsView={isPluginEnabled('tags-page')}
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
            views={sidebarViews}
            onTableSelect={(tableId, viewId = null, fromHistory = false) => {
                handleTableSelect(tableId, viewId, fromHistory);
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

        // PDF tabs: integrated viewer. It has no Markdown content or
        // Vault metadata — only the file path. It behaves like
        // any tab (it can be closed, reordered, split-view).
        if (tab.isPdf) {
            return (
                <ZoteroReaderTab
                    key={tab.id}
                    src={tab.src}
                    title={tab.title}
                    kind={tab.kind || 'pdf'}
                    location={tab.location || null}
                    // "Back" button of the viewer → closes the document and returns to
                    // it was opened from (handleTabClose honors `tab.origin`).
                    onClose={() => handleTabClose(tab.id)}
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

            // Get views for this specific table
            const displayViews = getTableViews(tableId);
            const currentViewId = activeTableId === tableId ? (activeViewId || displayViews[0].id) : displayViews[0].id;
            const cv = displayViews.find(v => v.id === currentViewId) || displayViews[0];

            return (
                <div className="h-full flex flex-col bg-white">
                    <VaultViewsHeader
                        tableName={table?.title || table?.name || t('common.table')}
                        recordCount={paneNotes.length}
                        notes={paneNotes}
                        referenceTableId={refTableId && refTableId === tableId ? tableId : undefined}
                        brainTableId={brainTableId && brainTableId === tableId ? tableId : undefined}
                        onReferencesImported={fetchPages}
                        onCreateFromSource={() => setCreateSourceTableId(tableId)}
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
                        onSetViewHidden={handleSetViewHidden}
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
                        onEditTemplate={(tpl) => loadPage(tpl.id)}
                        onDuplicateTemplate={handleDuplicateTemplate}
                        onSetDefaultTemplate={handleSetDefaultTemplate}
                        onDeleteTemplate={(tpl) => setTemplateToDelete(tpl)}
                        searchTerm={searchTerm}
                        setSearchTerm={setSearchTerm}
                        templates={paneTemplates}
                    />
                    <div className="flex-1 overflow-hidden flex flex-col">
                        {(() => {
                            // The `graph` has no equivalent editable component → kept separate.
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

                            const onEditSchema = (type) => {
                                setActiveTableId(tableId);
                                if (type === 'filters' || type === 'sorts') {
                                    setViewToConfigure(cv);
                                    setViewConfigTab(type);
                                    setIsViewConfigOpen(true);
                                } else {
                                    setIsSchemaModalOpen(true);
                                }
                            };

                                    const { mergedView, mergedSchema } = prepareDashboardViewContext(cv, table, registry.tables);
                                    
                                    const body = (
                                        <VaultViewBody
                                            type={mergedView.type}
                                            functionalities={table?.functionalities}
                                            notes={applyDashboardJoins(paneNotes, cv.joins, pages, resolvePageTableId)}
                                            templates={paneTemplates}
                                            schema={mergedSchema}
                                            idToTitle={globalIndex}
                                            allNotes={pages}
                                            activeView={mergedView}
                                            searchTerm={searchTerm}
                                            onNoteSelect={(pageId, openContext) => openRecordFromView(pageId, tableId, currentViewId, openContext)}
                                            restoreRecordFocus={recordReturnFocus?.isArmed === true && recordReturnFocus.tableId === tableId && consumedRecordReturnFocusRef.current !== recordReturnFocus.requestId && (!recordReturnFocus.viewId || recordReturnFocus.viewId === currentViewId) ? recordReturnFocus : null}
                                            onRecordFocusRestored={handleRecordFocusRestored}
                                    onSearchChange={setSearchTerm}
                                    onUpdateView={handleUpdateView}
                                    onDeletePage={handleDeletePage}
                                    onDeleteSelected={handleDeleteSelected}
                                    onApplyTemplate={(ids, templateId) => handleApplyTemplate(ids, templateId, tableId)}
                                    onCreateNotebook={canCreateNotebookFromTable(refTableId, tableId) ? createNotebookFromSelection : undefined}
                                    onEditSchema={onEditSchema}
                                    onOpenParallel={handleOpenParallel}
                                    onUpdateFieldOptions={handleAddSchemaOption}
                                    onUpdateNote={handleUpdateNote}
                                    onCellSaved={async () => {
                                        await fetchPagesByTable(tableId);
                                    }}
                                    onTranslated={(data) => refreshTableAfterTranslate(tableId, data)}
                                    onCreateRecord={(templateId = null) => handleAddNewNote(tableId, templateId)}
                                />
                            );

                            const wrapperClass = {
                                board: 'p-0 h-full overflow-y-auto w-full custom-scrollbar bg-[var(--bg-primary)]',
                                calendar: 'p-6 h-full',
                                gallery: 'p-0 h-full overflow-hidden w-full',
                                timeline: 'p-0 h-full overflow-hidden w-full bg-[var(--bg-primary)]',
                                feed: 'p-0 h-full overflow-y-auto w-full custom-scrollbar bg-[var(--bg-primary)]',
                            }[cv.type];

                            return wrapperClass ? <div className={wrapperClass}>{body}</div> : body;
                        })()}
                    </div>
                </div>
            );
        }

        // Daily notes: day navigation bar (← previous day · Today · next day →),
        // Obsidian style. Only shown if the active page is a daily note.
        const dailyDate = isPluginEnabled('daily-notes') && tab.metadata?.note_type === 'daily'
            ? (tab.metadata?.date || tab.title)
            : null;
        const shiftDay = (iso, delta) => {
            const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
            if (!m) return null;
            const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
            d.setDate(d.getDate() + delta);
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        };
        const dailyBar = dailyDate ? (
            <div className="flex items-center justify-center gap-1 px-4 py-1.5 border-b border-[var(--border-primary)] bg-[var(--bg-primary)] text-sm">
                <button
                    type="button"
                    onClick={() => { const p = shiftDay(dailyDate, -1); if (p) handleOpenDailyNote(p); }}
                    className="p-1 rounded hover:bg-[var(--bg-primary)] text-[var(--text-secondary)]"
                    title={t('vault.daily_prev', "Previous daily note")}
                >
                    <ChevronLeft size={16} />
                </button>
                <button
                    type="button"
                    onClick={() => handleOpenDailyNote()}
                    className="px-2 py-0.5 rounded hover:bg-[var(--bg-primary)] text-[var(--text-primary)] font-medium"
                >
                    {t('vault.daily_today', "Today's daily note")}
                </button>
                <button
                    type="button"
                    onClick={() => { const n = shiftDay(dailyDate, 1); if (n) handleOpenDailyNote(n); }}
                    className="p-1 rounded hover:bg-[var(--bg-primary)] text-[var(--text-secondary)]"
                    title={t('vault.daily_next', "Next daily note")}
                >
                    <ChevronRight size={16} />
                </button>
            </div>
        ) : null;

        const editorEl = (
            // key MUST be the page id so React unmounts the BlockEditor (and
            // resets all its refs and timers) when the user navigates to a
            // different note. Otherwise the spurious-autosave + unmount-save
            // logic in BlockEditor can fire a final PATCH against the wrong
            // note when reconciliation reuses the component instance.
            <BlockEditor
                key={tab.id}
                noteFilename={tab.id}
                referenceTableId={refTableId}
                onCreateFromSource={(tableId) => setCreateSourceTableId(tableId)}
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
                aliasIndex={aliasIndex}
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
                onCreateTemplate={(tableId) => setPromptModal({ isOpen: true, defaultTitle: t('common.new_template'), parentId: null, isDatabase: false, isDrawing: false, isView: false, isTemplate: true, templateTableId: tableId, inputValue: t('common.new_template'), isLoading: false })}
                onOpenViewConfig={handleConfigureView}
                pageActions={pageActions}
                isActivePage={tab.id === activeTabId}
            />
        );

        if (!dailyBar) return editorEl;
        return (
            <div className="h-full flex flex-col min-h-0">
                {dailyBar}
                <div className="flex-1 min-h-0 overflow-hidden">{editorEl}</div>
            </div>
        );
    };

    const renderTablePane = (tableId) => {
        const table = registry.tables?.find(t => t.id === tableId);
        const paneNotes = getTableVisibleRecords(tableId);
        const paneTemplates = pages.filter(p => resolvePageTableId(p) === tableId && p.metadata?.is_template);

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
                    tableName={table?.title || table?.name || t('common.table')}
                    recordCount={paneNotes.length}
                    notes={paneNotes}
                    referenceTableId={refTableId && refTableId === tableId ? tableId : undefined}
                    brainTableId={brainTableId && brainTableId === tableId ? tableId : undefined}
                    onReferencesImported={fetchPages}
                    onCreateFromSource={() => setCreateSourceTableId(tableId)}
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
                    onSetViewHidden={handleSetViewHidden}
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
                    onEditTemplate={(tpl) => loadPage(tpl.id)}
                    onDuplicateTemplate={handleDuplicateTemplate}
                    onSetDefaultTemplate={handleSetDefaultTemplate}
                    onDeleteTemplate={(tpl) => setTemplateToDelete(tpl)}
                    searchTerm={searchTerm}
                    setSearchTerm={setSearchTerm}
                    templates={paneTemplates}
                    onClose={handleCloseTablePane}
                />
                <div className="flex-1 overflow-hidden flex flex-col">
                    {(() => {
                        // The `graph` has no equivalent editable component → kept separate.
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

                        const onEditSchema = (type) => {
                            setActiveTableId(tableId);
                            if (type === 'filters' || type === 'sorts') {
                                setViewToConfigure(cv);
                                setViewConfigTab(type);
                                setIsViewConfigOpen(true);
                            } else {
                                setIsSchemaModalOpen(true);
                            }
                        };

                        const table = registry.tables?.find(t => t.id === tableId);
                        const { mergedView, mergedSchema } = prepareDashboardViewContext(cv, table, registry.tables);
                        
                        const body = (
                            <VaultViewBody
                                type={mergedView.type}
                                notes={applyDashboardJoins(paneNotes, cv.joins, pages, resolvePageTableId)}
                                templates={paneTemplates}
                                schema={mergedSchema}
                                idToTitle={globalIndex}
                                allNotes={pages}
                                activeView={mergedView}
                                isEmbedded={true}
                                searchTerm={searchTerm}
                                actionRules={registry.tables?.find(x => x.id === tableId)?.action_rules}
                                functionalities={table?.functionalities}
                                onNoteSelect={(pageId, openContext) => openRecordFromView(pageId, tableId, currentViewId, openContext)}
                                restoreRecordFocus={recordReturnFocus?.isArmed === true && recordReturnFocus.tableId === tableId && consumedRecordReturnFocusRef.current !== recordReturnFocus.requestId && (!recordReturnFocus.viewId || recordReturnFocus.viewId === currentViewId) ? recordReturnFocus : null}
                                onRecordFocusRestored={handleRecordFocusRestored}
                                onSearchChange={setSearchTerm}
                                onUpdateView={handleUpdateView}
                                onDeletePage={handleDeletePage}
                                onDeleteSelected={handleDeleteSelected}
                                onApplyTemplate={(ids, templateId) => handleApplyTemplate(ids, templateId, tableId)}
                                onEditSchema={onEditSchema}
                                onOpenParallel={handleOpenParallel}
                                onUpdateFieldOptions={handleAddSchemaOption}
                                onUpdateNote={handleUpdateNote}
                                onCellSaved={async () => {
                                    await fetchPagesByTable(tableId);
                                }}
                                onTranslated={(data) => refreshTableAfterTranslate(tableId, data)}
                                onCreateRecord={(templateId) => handleAddNewNote(tableId, templateId)}
                            />
                        );

                        const wrapperClass = {
                            board: 'p-0 h-full overflow-y-auto w-full custom-scrollbar bg-[var(--bg-primary)]',
                            calendar: 'p-6 h-full',
                            gallery: 'p-0 h-full overflow-hidden w-full',
                            timeline: 'p-0 h-full overflow-hidden w-full bg-[var(--bg-primary)]',
                            feed: 'p-0 h-full overflow-y-auto w-full custom-scrollbar bg-[var(--bg-primary)]',
                        }[cv.type];

                        return wrapperClass ? <div className={wrapperClass}>{body}</div> : body;
                    })()}
                </div>
            </div>
        );
    };

    const activeTable = registry.tables?.find(t => t.id === activeTableId);
    const activeContextTab = activeTabId
        ? tabs.find(tab => tab.id === activeTabId) || null
        : null;
    const activeContextTabTableId = getTableIdFromTab(activeContextTab);
    const activeContextEmbeddedViewIds = vaultPageViewIds(activeContextTab);
    const activeContextEmbeddedView = activeContextEmbeddedViewIds.length === 1
        ? (registry.views || []).find(
            view => view.id === activeContextEmbeddedViewIds[0],
        ) || null
        : null;
    const activeContextPage = activeTabId
        && !activeContextTabTableId
        && !activeContextEmbeddedView
        ? activeContextTab || pages.find(page => page.id === activeTabId) || null
        : null;
    const activeContextTableId = activeContextTabTableId
        || activeContextEmbeddedView?.table_id
        || (viewMode === 'table' ? activeTableId : resolvePageTableId(activeContextPage));
    const activeContextTable = registry.tables?.find(
        table => table.id === activeContextTableId,
    ) || null;
    const activeContextView = activeContextEmbeddedView || (activeContextTableId
        ? (registry.views || []).find(
            view => view.id === activeViewId && view.table_id === activeContextTableId,
        ) || null
        : null);

    useEffect(() => {
        window.dispatchEvent(new CustomEvent('gnosi:module-context', {
            detail: vaultAgentContextRefs({
                page: activeContextPage,
                table: activeContextTable,
                view: activeContextView,
            }),
        }));
    }, [activeContextPage, activeContextTable, activeContextView]);

    return (
        <VaultShell
            sidebarContent={sidebar}
            breadcrumbs={breadcrumbs}
            onSearch={() => setIsGlobalSearchOpen(true)}
            onBack={handleNavigationBack}
            onForward={handleNavigationForward}
            canGoBack={canGoBack}
            canGoForward={canGoForward}
            showDocumentControls={(viewMode === 'editor' || viewMode === 'drawing') && tabs.length === 1}
            onNewDocument={() => window.dispatchEvent(new Event('gnosi:quick-open-document'))}
            onCloseDocument={() => activeTabId && handleTabClose(activeTabId)}
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
                                        className={`flex flex-col overflow-hidden min-w-0 ${index > 0 ? 'bg-[var(--bg-primary)]' : ''}`}
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
                                <Suspense fallback={<div className="flex-1 flex items-center justify-center text-sm text-[var(--text-secondary)] animate-pulse">{t('editor.loading_drawing_editor')}</div>}>
                                    <TldrawEditor
                                        key={activeTabId}
                                        drawingId={activeTabId}
                                        allNotes={pages}
                                        tables={registry.tables}
                                        title={tabs.find(t => t.id === activeTabId)?.title}
                                        onClose={() => {
                                            handleTabClose(activeTabId);
                                            setViewMode('editor');
                                        }}
                                        onSaveSuccess={() => { }}
                                        onOpenPage={(pageId) => { setViewMode('editor'); loadPage(pageId); }}
                                    />
                                </Suspense>
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
                    ) : viewMode === 'tags' ? (
                        <VaultTagsView onPageSelect={loadPage} />
                    ) : viewMode === 'table' && activeTableId ? (
                        <div className="flex-1 flex flex-col overflow-hidden min-w-0 bg-[var(--bg-primary)]">
                            {(() => {
                                const displayViews = getTableViews(activeTableId);

                                return (
                                    <VaultViewsHeader
                                        tableName={activeTable ? (activeTable.title || activeTable.name) : t('common.table')}
                                        recordCount={(tableNotes || []).length}
                                        notes={tableNotes || []}
                                        referenceTableId={refTableId && refTableId === activeTableId ? activeTableId : undefined}
                                        brainTableId={brainTableId && brainTableId === activeTableId ? activeTableId : undefined}
                                        onReferencesImported={fetchPages}
                                        onCreateFromSource={() => setCreateSourceTableId(activeTableId)}
                                        views={displayViews}
                                        activeViewId={activeViewId || 'default'}
                                        onViewSelect={setActiveViewId}
                                        onAddView={handleAddView}
                                        onEditView={handleConfigureView}
                                        onDuplicateView={handleDuplicateView}
                                        onDeleteView={handleDeleteView}
                                        onReorderViews={handleReorderViews}
                                        onRenameView={handleRenameView}
                                        onSetViewHidden={handleSetViewHidden}
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
                                        onEditTemplate={(tpl) => loadPage(tpl.id)}
                                        onDuplicateTemplate={handleDuplicateTemplate}
                                        onSetDefaultTemplate={handleSetDefaultTemplate}
                                        onDeleteTemplate={(tpl) => setTemplateToDelete(tpl)}
                                        searchTerm={searchTerm}
                                        setSearchTerm={setSearchTerm}
                                        templates={tableTemplates}
                                    />
                                );
                            })()}

                            <div className="flex-1 overflow-hidden">
                                {(() => {
                                    const displayViews = getTableViews(activeTableId);
                                    const cv = displayViews.find(v => v.id === activeViewId) || displayViews[0] || { id: 'default', name: registry.tables?.find(t => t.id === activeTableId)?.name || MAIN_VIEW_NAME, type: 'table', sort: { field: 'title', direction: 'asc' }, filters: [], is_main: true };

                                    const onEditSchema = (type) => {
                                        if (type === 'filters' || type === 'sorts') {
                                            setViewToConfigure(cv);
                                            setViewConfigTab(type);
                                            setIsViewConfigOpen(true);
                                        } else {
                                            setIsSchemaModalOpen(true);
                                        }
                                    };

                                    // The `graph` has no equivalent editable component → kept
                                    // separately (as split panels already did). Without
                                    // this branch, VaultViewBody treated it as a table.
                                    // Full-height flex wrapper: VaultGraph's root is
                                    // `flex-1` and in a non-flex parent it ended up with height 0.
                                    if (cv.type === 'graph') {
                                        return (
                                            <div className="h-full flex flex-col">
                                                <VaultGraph
                                                    tableId={activeTableId}
                                                    view={cv}
                                                    searchTerm={searchTerm}
                                                    isDarkMode={document.documentElement.classList.contains('dark')}
                                                    onNodeClick={(nodeId) => loadPage(nodeId)}
                                                />
                                            </div>
                                        );
                                    }

                                    const table = registry.tables?.find(t => t.id === activeTableId);
                                    const { mergedView, mergedSchema } = prepareDashboardViewContext(cv, table, registry.tables);

                                    const body = (
                                        <VaultViewBody
                                            type={mergedView.type}
                                            notes={applyDashboardJoins(tableNotes, cv.joins, pages, resolvePageTableId)}
                                            templates={tableTemplates}
                                            schema={mergedSchema}
                                            idToTitle={globalIndex}
                                            allNotes={pages}
                                            activeView={mergedView}
                                            isEmbedded={false}
                                            searchTerm={searchTerm}
                                            actionRules={registry.tables?.find(x => x.id === activeTableId)?.action_rules}
                                            functionalities={table?.functionalities}
                                            onNoteSelect={(pageId, openContext) => openRecordFromView(pageId, activeTableId, cv.id, openContext)}
                                            restoreRecordFocus={recordReturnFocus?.isArmed === true && recordReturnFocus.tableId === activeTableId && consumedRecordReturnFocusRef.current !== recordReturnFocus.requestId && (!recordReturnFocus.viewId || recordReturnFocus.viewId === cv.id) ? recordReturnFocus : null}
                                            onRecordFocusRestored={handleRecordFocusRestored}
                                            onSearchChange={setSearchTerm}
                                            onUpdateView={handleUpdateView}
                                            onDeletePage={handleDeletePage}
                                            onDeleteSelected={handleDeleteSelected}
                                            onApplyTemplate={(ids, templateId) => handleApplyTemplate(ids, templateId, activeTableId)}
                                            onCreateNotebook={canCreateNotebookFromTable(refTableId, activeTableId) ? createNotebookFromSelection : undefined}
                                            onEditSchema={onEditSchema}
                                            onOpenParallel={handleOpenParallel}
                                            onUpdateFieldOptions={handleAddSchemaOption}
                                            onUpdateNote={handleUpdateNote}
                                            onCellSaved={async () => {
                                                if (activeTableId) {
                                                    await fetchPagesByTable(activeTableId);
                                                } else {
                                                    await fetchPages();
                                                }
                                            }}
                                            onTranslated={(data) => refreshTableAfterTranslate(activeTableId, data)}
                                            onCreateRecord={(templateId) => handleAddNewNote(activeTableId, templateId)}
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
                                        />
                                    );

                                    // Per-type wrappers (height/scroll/padding/background);
                                    // table/list don't carry one. The body is always VaultViewBody.
                                    const wrapperClass = {
                                        board: 'p-0 h-full overflow-y-auto w-full custom-scrollbar bg-[var(--bg-primary)]',
                                        calendar: 'p-6 h-full',
                                        gallery: 'p-0 h-full overflow-hidden w-full',
                                        timeline: 'p-0 h-full overflow-hidden w-full bg-[var(--bg-primary)]',
                                        feed: 'p-0 h-full overflow-y-auto w-full custom-scrollbar bg-[var(--bg-primary)]',
                                    }[cv.type];

                                    return wrapperClass ? <div className={wrapperClass}>{body}</div> : body;
                                })()}
                            </div>
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center w-full h-[80vh] text-[var(--text-tertiary)] px-4">
                            <FileText size={64} className="mb-4 text-[var(--bg-tertiary)]" strokeWidth={1} />
                            <h2 className="text-xl font-medium text-[var(--text-secondary)]">{t('vault_welcome_title', "Welcome")}</h2>
                            <p className="mt-2 max-w-md text-center">{t('vault_welcome_subtitle', "Select a knowledge page or")}</p>
                            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                                <button
                                    onClick={() => handleOpenCreatePrompt(null, false)}
                                    className="btn btn-gnosi-primary"
                                >
                                    {t('vault_welcome_create_page', "Create a page")}
                                </button>
                                <button
                                    onClick={() => handleOpenCreatePrompt(null, true)}
                                    className="btn btn-gnosi-primary"
                                >
                                    {t('vault_welcome_create_db', "Create a DB")}
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
                tables={registry.tables}
                globalIndex={globalIndex}
                aliasesById={aliasIndex}
                onNoteSelect={loadPage}
            />

            <TagsModal
                isOpen={isPluginEnabled('tags-page') && isTagsOpen}
                onClose={() => setIsTagsOpen(false)}
                allNotes={pages}
                onNoteSelect={loadPage}
            />

            <PresentationMode
                isOpen={isPresentOpen}
                onClose={() => setIsPresentOpen(false)}
                markdown={currentActiveTab?.content || ''}
            />

            <InlineComments
                pageId={(viewMode === 'editor' && currentOpenPage && currentActiveTab && !currentActiveTab.isTable && !currentActiveTab.isPdf) ? activeTabId : null}
            />

            <WorkspacesModal
                isOpen={isWorkspacesOpen}
                onClose={() => setIsWorkspacesOpen(false)}
                currentTabs={tabs}
                onRestore={(savedTabs) => {
                    (savedTabs || []).forEach((t) => {
                        if (t.isTable) handleTableSelect(t.id);
                        else loadPage(t.id);
                    });
                }}
            />

            <MetadataLookupModal
                isOpen={!!createSourceTableId}
                mode="create"
                onClose={() => setCreateSourceTableId(null)}
                onCreate={(suggested) => {
                    const tid = createSourceTableId;
                    setCreateSourceTableId(null);
                    handleCreateFromSource(tid, suggested);
                }}
            />

            <RecentModal
                isOpen={isRecentOpen}
                onClose={() => setIsRecentOpen(false)}
                allNotes={pages}
                onNoteSelect={loadPage}
            />

            {translatePageModalId && (
                <TranslateLanguagesModal
                    isOpen={true}
                    mode={translatePageMode}
                    noteId={translatePageModalId}
                    recordMetadata={currentOpenPage?.metadata || {}}
                    schema={openPageTableId ? getSchemaFromTableId(openPageTableId) : {}}
                    onClose={() => setTranslatePageModalId(null)}
                    onTranslated={(data) => { setTranslatePageModalId(null); refreshTableAfterTranslate(openPageTableId, data); }}
                />
            )}

            {resourceToProcess && (
                <ProcessResourceModal
                    isOpen={true}
                    onClose={() => setResourceToProcess(null)}
                    noteId={resourceToProcess.noteId}
                    title={resourceToProcess.title}
                    sourceTableId={resourceToProcess.sourceTableId}
                    force={resourceToProcess.force}
                    onJobUpdate={(nextJob) => {
                        setLlmWikiJobs((current) => ({
                            ...current,
                            [resourceToProcess.sourceTableId]: {
                                ...(current[resourceToProcess.sourceTableId] || {}),
                                [resourceToProcess.noteId]: nextJob,
                            },
                        }));
                    }}
                    onProcessed={fetchPages}
                    onContinueInBackground={(job) => {
                        setBackgroundLlmWikiJobs((current) => ({
                            ...current,
                            [job.job_id]: job,
                        }));
                    }}
                />
            )}

            {
                viewToDelete && (
                    <ConfirmModal
                        isOpen={!!viewToDelete}
                        onClose={() => { setViewToDelete(null); setViewToDeleteUsage(null); }}
                        onConfirm={executeDeleteView}
                        title={t('common.confirm_delete_view')}
                        message={
                            viewToDeleteUsage && viewToDeleteUsage.count > 0
                                ? `${t('views_header.delete_linked_view_confirm', { count: viewToDeleteUsage.count, name: viewToDelete.name, defaultValue: "Aquesta vista està enllaçada a {{count}} pàgina(es):" })}\n\n${viewToDeleteUsage.pages.map(p => `• ${p.title}`).join('\n')}\n\n${t('views_header.confirm_delete_anyway', { defaultValue: "Segur que la vols eliminar de totes maneres?" })}`
                                : t('common.confirm_delete_view_msg', { name: viewToDelete.name })
                        }
                        confirmText={t('common.delete')}
                        isDestructive={true}
                    />
                )
            }

            {
                templateToDelete && (
                    <ConfirmModal
                        isOpen={!!templateToDelete}
                        onClose={() => setTemplateToDelete(null)}
                        onConfirm={async () => {
                            await handleDeletePage(templateToDelete.id, templateToDelete.title);
                            setTemplateToDelete(null);
                        }}
                        title={t('common.confirm_delete_template')}
                        message={t('common.confirm_delete_template_msg', { title: templateToDelete.title || t('common.untitled') })}
                        confirmText={t('common.delete')}
                        isDestructive={true}
                    />
                )
            }

            {
                promptModal.isOpen && (
                    <div
                        className="fixed inset-0 bg-black/60 backdrop-blur-[2px] z-[var(--z-modal)] flex items-center justify-center p-4"
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
                    const cv = getTableViews(activeTableId).find(v => v.id === activeViewId) || { id: 'default', table_id: activeTableId, name: activeTable?.name || MAIN_VIEW_NAME, type: 'table', is_main: true };
                    const currentSchemaObj = getSchemaFromTableId(activeTableId);
                    return (
                        <SchemaConfigModal
                            isOpen={true}
                            onClose={() => setIsSchemaModalOpen(false)}
                            folder={activeTable?.name || t('common.table')}
                            currentSchema={currentSchemaObj}
                            initialEnableSubitems={cv?.enableSubitems}
                            initialEnableTranslation={!!activeTable?.translation_enabled}
                            initialVisibleProperties={cv?.visibleProperties?.length ? cv.visibleProperties : getSchemaFieldNames(currentSchemaObj)}
                            initialEnableDrupalSync={!!activeTable?.drupal_sync_enabled}
                            initialDrupalBundle={activeTable?.drupal_bundle || ''}
                            initialDrupalFieldMapping={activeTable?.drupal_field_mapping || {}}
                            initialFunctionalities={activeTable?.functionalities || []}
                            tableId={activeTableId}
                            onSchemaUpdated={(newSchema) => setSchema(newSchema)}
                            onSave={async (newSchemaObj, viewConfig) => {
                                const newProperties = buildTablePropertiesFromSchema(newSchemaObj);
                                try {
                                    // 1. Update table schema (Backend registry).
                                    // `translation_enabled` is metadata of the table
                                    // (not of the view) because it defines what can be
                                    // translated, not how it's displayed.
                                    await axios.post(`/api/vault/tables`, {
                                        ...activeTable,
                                        properties: newProperties,
                                        translation_enabled: !!viewConfig.enableTranslation,
                                        drupal_sync_enabled: !!viewConfig.enableDrupalSync,
                                        // We keep bundle and mapping even though the
                                        // sync is disabled: disabling
                                        // must not destroy the mapping (it's recovered if
                                        // re-enabled). Previously '' / {} used to be sent, and an autosave
                                        // with the toggle off would erase the entire mapping.
                                        drupal_bundle: viewConfig.drupalBundle || '',
                                        drupal_field_mapping: viewConfig.drupalFieldMapping || {},
                                        functionalities: viewConfig.functionalities || [],
                                    });
                                    setSchema(newSchemaObj);

                                    // 2. Update view configuration if it exists.
                                    // The user's REAL field selection is saved
                                    // also for the main view (previously it was
                                    // rewritten to the whole schema and the selection was
                                    // perdia en silenci).
                                    if (cv?.id) {
                                        await handleUpdateView({
                                            ...cv,
                                            enableSubitems: viewConfig.enableSubitems,
                                            visibleProperties: viewConfig.visibleProperties
                                        });
                                    }

                                    await fetchRegistry();
                                    // We don't close the modal or show a toast: the modal
                                    // does continuous autosave — closing it on every save
                                    // would kick it out on the user's first change.
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
                    // The SAME modal as for the embed (PageViewModal), in mode
                    // "table": configures/creates a table view with fewer
                    // options (no source table, heading, scope, or "save
                    // to views"). `editingView` with id → updates; without
                    // id (e.g. {type}) → creates a new view.
                    <PageViewModal
                        isOpen={isViewConfigOpen}
                        mode="table"
                        pageId={null}
                        allTables={registry.tables}
                        apiFetch={viewModalApiFetch}
                        preselectedTableId={activeTableId}
                        editingView={viewToConfigure}
                        initialTab={viewConfigTab}
                        onClose={(saved, savedView) => {
                            setIsViewConfigOpen(false);
                            setViewToConfigure(null);
                            if (saved && savedView) {
                                fetchRegistry();
                                if (savedView.id) setActiveViewId(String(savedView.id));
                                if (onViewConfigSavedRef.current) {
                                    onViewConfigSavedRef.current(savedView);
                                }
                            }
                            onViewConfigSavedRef.current = null;
                        }}
                    />
                )
            }
            <PageComments
                pageId={currentOpenPage?.id}
                pageTitle={currentOpenPage?.title}
                open={isPluginEnabled('page-comments') && commentsOpen && Boolean(currentOpenPage)}
                onClose={() => setCommentsOpen(false)}
            />
            <ShareModal
                pageId={currentOpenPage?.id}
                pageTitle={currentOpenPage?.title}
                open={isPluginEnabled('share-links') && shareOpen && Boolean(currentOpenPage)}
                onClose={() => setShareOpen(false)}
            />
        </VaultShell >
    );
}
