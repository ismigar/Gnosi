import React from 'react';
import { useCallback, useState } from 'react';
import { useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { usePlugins } from '../../../shared/plugins/usePlugins';
import type { Page, Tab, RecordReturnFocus, View, PromptState, WikiConfig, ResourceJobs, ResourceTarget, ViewMode, Registry, ViewDraft, HistoryEntry, HistoryOperation, PageResponse } from './types';
import type { ViewUsage } from '../../../shared/api/vault-views';
import type { ResourceProcessingJob } from '../../../shared/api/resource-processing';
import { readStorage } from '../../../shared/platform/browser-storage';
import { EDIT_LOCKS } from './storage';
export function useDashboardState() {
    const { t, i18n } = useTranslation();
    const navigate = useNavigate();
    const { "*": nestedPath } = useParams();
    const { isEnabled: isPluginEnabled } = usePlugins();
    const [pages, setPages] = useState<Page[]>([]);
    const pagesRef = useRef<Page[]>([]);
    const viewCreationInProgressRef = useRef<Set<string>>(new Set());
    const [tabs, setTabs] = useState<Tab[]>([]);
    const [activeTabId, setActiveTabId] = useState<string | null>(null);
    const [recordReturnFocus, setRecordReturnFocus] = useState<RecordReturnFocus | null>(null);
    const recordReturnFocusSequenceRef = useRef(0);
    const consumedRecordReturnFocusRef = useRef<number | null>(null);
    const [consumedRecordReturnFocus, setConsumedRecordReturnFocus] = useState<number | null>(null);
    const [codeViewByTabId, setCodeViewByTabId] = useState<Record<string, boolean>>({});
    const [editLockedByPageId, setEditLockedByPageId] = useState(() => readStorage(EDIT_LOCKS) || {});
    const [splitTabIds, setSplitTabIds] = useState<string[]>([]);
    const [splitTableIds, setSplitTableIds] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);
    const [isRegistryLoading, setIsRegistryLoading] = useState(true);
    const [viewToDelete, setViewToDelete] = useState<View | null>(null);
    const [viewToDeleteUsage, setViewToDeleteUsage] = useState<ViewUsage | null>(null);
    const [templateToDelete, setTemplateToDelete] = useState<Page | null>(null);
    const [promptModal, setPromptModal] = useState<PromptState>({ isOpen: false, defaultTitle: '', parentId: null, isDatabase: false, isDrawing: false, isDashboard: false, isView: false, isRename: false, isTemplate: false, templateTableId: null, targetView: null, viewType: null, inputValue: '', isLoading: false });
    const isPluginEnabledRef = useRef(isPluginEnabled);
    const [llmWikiConfig, setLlmWikiConfig] = useState<WikiConfig | null>(null);
    const [llmWikiJobs, setLlmWikiJobs] = useState<ResourceJobs>({});
    const [resourceToProcess, setResourceToProcess] = useState<ResourceTarget | null>(null);
    const [backgroundLlmWikiJobs, setBackgroundLlmWikiJobs] = useState<Record<string, ResourceProcessingJob>>({});
    const [viewMode, setViewMode] = useState<ViewMode>('editor');
    const [schema, setSchema] = useState<Record<string, unknown>>({});
    const [views, setViews] = useState<View[]>([]);
    const [activeViewId, setActiveViewId] = useState<string | null>(null);
    const [isGlobalSearchOpen, setIsGlobalSearchOpen] = useState(false);
    const [isTagsOpen, setIsTagsOpen] = useState(false);
    const [isPresentOpen, setIsPresentOpen] = useState(false);
    const [isWorkspacesOpen, setIsWorkspacesOpen] = useState(false);
    const [isRecentOpen, setIsRecentOpen] = useState(false);
    const [translatePageModalId, setTranslatePageModalId] = useState<string | null>(null);
    const [translatePageMode, setTranslatePageMode] = useState<'page' | 'row'>('page');
    const [historyOpenSignal, setHistoryOpenSignal] = useState(0);
    const [commentsOpen, setCommentsOpen] = useState(false);
    const [shareOpen, setShareOpen] = useState(false);
    const [globalIndex, setGlobalIndex] = useState<Record<string, string>>({});
    const [aliasIndex, setAliasIndex] = useState<Record<string, string[]>>({});
    const [registry, setRegistry] = useState<Registry>({ databases: [], tables: [], views: [] });
    const [activeTableId, setActiveTableId] = useState<string | null>(null);
    const [tableNotes, setTableNotes] = useState<Page[]>([]);
    const [tableTemplates, setTableTemplates] = useState<Page[]>([]);
    const [visibleTableRecordsById, setVisibleTableRecordsById] = useState<Record<string, Page[]>>({});
    const [_tableCountsById, setTableCountsById] = useState<Record<string, {
        raw: number;
        visible: number;
    }>>({});
    const [isSchemaModalOpen, setIsSchemaModalOpen] = useState(false);
    const [isViewConfigOpen, setIsViewConfigOpen] = useState(false);
    const [viewToConfigure, setViewToConfigure] = useState<ViewDraft | null>(null);
    const [viewConfigTab, setViewConfigTab] = useState('appearance');
    const [searchTerm, setSearchTerm] = useState('');
    const pageRequestInFlightRef = useRef<Map<string, Promise<PageResponse>>>(new Map());
    const activeLoadAbortRef = useRef<AbortController | null>(null);
    const pageRequestAbortersRef = useRef<Map<string, AbortController>>(new Map());
    const [navigationHistory, setNavigationHistory] = useState<HistoryEntry[]>([]);
    const [historyPointer, setHistoryPointer] = useState(-1);
    const [undoStack, setUndoStack] = useState<HistoryOperation[]>([]);
    const [redoStack, setRedoStack] = useState<HistoryOperation[]>([]);
    const undoRef = useRef<(() => Promise<void>) | null>(null);
    const redoRef = useRef<(() => Promise<void>) | null>(null);
    const pendingRelationUndoRef = useRef<(() => Promise<void>) | null>(null);
    const setPendingRelationUndo = useCallback((operation: (() => Promise<void>) | null) => {
        pendingRelationUndoRef.current = operation;
    }, []);
    const undoStackLenRef = useRef(0);
    const redoStackLenRef = useRef(0);
    const activeTableIdRef = useRef<string | null>(null);
    const activeTabIdRef = useRef<string | null>(null);
    const activeViewIdRef = useRef<string | null>(null);
    const viewModeRef = useRef('editor');
    const [createSourceTableId, setCreateSourceTableId] = useState<string | null>(null);
    const [refTableId, setRefTableId] = useState<string | null>(null);
    const [brainTableId, setBrainTableId] = useState<string | null>(null);
    const fetchPagesRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const fullPageCatalogLoadedRef = useRef(false);
    const isCreatingNoteRef = useRef(false);
    const onViewConfigSavedRef = useRef<((view: ViewDraft) => unknown) | null | undefined>(null);
    const loadPageRef = useRef<((id: string) => Promise<void>) | null>(null);
    const closePromptModalRef = useRef<(() => void) | null>(null);
    const [paneSizes, setPaneSizes] = useState<number[]>([]);
    const paneContainerRef = React.useRef<HTMLDivElement | null>(null);
    return {
        _tableCountsById,
        activeLoadAbortRef,
        activeTabId,
        activeTabIdRef,
        activeTableId,
        activeTableIdRef,
        activeViewId,
        activeViewIdRef,
        aliasIndex,
        backgroundLlmWikiJobs,
        brainTableId,
        closePromptModalRef,
        codeViewByTabId,
        commentsOpen,
        consumedRecordReturnFocusRef,
        consumedRecordReturnFocus,
        setConsumedRecordReturnFocus,
        createSourceTableId,
        editLockedByPageId,
        fetchPagesRetryTimerRef,
        fullPageCatalogLoadedRef,
        globalIndex,
        historyOpenSignal,
        historyPointer,
        i18n,
        isCreatingNoteRef,
        isGlobalSearchOpen,
        isPluginEnabled,
        isPluginEnabledRef,
        isPresentOpen,
        isRecentOpen,
        isRegistryLoading,
        isSchemaModalOpen,
        isTagsOpen,
        isViewConfigOpen,
        isWorkspacesOpen,
        llmWikiConfig,
        llmWikiJobs,
        loadPageRef,
        loading,
        navigate,
        navigationHistory,
        nestedPath,
        onViewConfigSavedRef,
        pageRequestAbortersRef,
        pageRequestInFlightRef,
        pages,
        pagesRef,
        paneContainerRef,
        paneSizes,
        pendingRelationUndoRef,
        setPendingRelationUndo,
        promptModal,
        recordReturnFocus,
        recordReturnFocusSequenceRef,
        redoRef,
        redoStack,
        redoStackLenRef,
        refTableId,
        registry,
        resourceToProcess,
        schema,
        searchTerm,
        setActiveTabId,
        setActiveTableId,
        setActiveViewId,
        setAliasIndex,
        setBackgroundLlmWikiJobs,
        setBrainTableId,
        setCodeViewByTabId,
        setCommentsOpen,
        setCreateSourceTableId,
        setEditLockedByPageId,
        setGlobalIndex,
        setHistoryOpenSignal,
        setHistoryPointer,
        setIsGlobalSearchOpen,
        setIsPresentOpen,
        setIsRecentOpen,
        setIsRegistryLoading,
        setIsSchemaModalOpen,
        setIsTagsOpen,
        setIsViewConfigOpen,
        setIsWorkspacesOpen,
        setLlmWikiConfig,
        setLlmWikiJobs,
        setLoading,
        setNavigationHistory,
        setPages,
        setPaneSizes,
        setPromptModal,
        setRecordReturnFocus,
        setRedoStack,
        setRefTableId,
        setRegistry,
        setResourceToProcess,
        setSchema,
        setSearchTerm,
        setShareOpen,
        setSplitTabIds,
        setSplitTableIds,
        setTableCountsById,
        setTableNotes,
        setTableTemplates,
        setTabs,
        setTemplateToDelete,
        setTranslatePageModalId,
        setTranslatePageMode,
        setUndoStack,
        setViewConfigTab,
        setViewMode,
        setViewToConfigure,
        setViewToDelete,
        setViewToDeleteUsage,
        setViews,
        setVisibleTableRecordsById,
        shareOpen,
        splitTabIds,
        splitTableIds,
        t,
        tableNotes,
        tableTemplates,
        tabs,
        templateToDelete,
        translatePageModalId,
        translatePageMode,
        undoRef,
        undoStack,
        undoStackLenRef,
        viewConfigTab,
        viewCreationInProgressRef,
        viewMode,
        viewModeRef,
        viewToConfigure,
        viewToDelete,
        viewToDeleteUsage,
        views,
        visibleTableRecordsById
    };
}
export type DashboardState = ReturnType<typeof useDashboardState>;
