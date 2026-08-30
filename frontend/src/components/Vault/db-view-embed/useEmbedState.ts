import { useState, type MouseEvent } from 'react';
import type { ViewUsage } from '../../../shared/api/vault-views';
import type { EmbedIdentity } from './identity';
import type { EmbedRow, EmbedView } from './types';
import { readPinned } from './preferences';
export function useEmbedState({ pageId, viewId, block, t }: EmbedIdentity) {
    const [view, setView] = useState<EmbedView | null>(null);          // the embedded SECTION (anchor: table + `this`)
    const [rawRecords, setRawRecords] = useState<EmbedRow[]>([]); // non-template records WITHOUT filtering
    const [templates, setTemplates] = useState<EmbedRow[]>([]);  // separate templates
    // PHASE 3: view tabs. List of the table's views (registry.views)
    // and which one is active. By default, the block's section view.
    const [tableViews, setTableViews] = useState<EmbedView[]>([]);
    const [activeViewId, setActiveViewId] = useState<string | null | undefined>('');
    const [loading, setLoading] = useState(() => Boolean(pageId && (viewId || block?.props?.section)));
    const [error, setError] = useState(() => {
        if (!pageId) return t('errors.no_active_page', "No active page to resolve the view.");
        if (!viewId && !block?.props?.section) return t('errors.view_missing_id', "View without view_id or inline config.");
        return '';
    });
    const [reloadKey, setReloadKey] = useState(0);
    const [searchTerm, setSearchTerm] = useState('');
    const [showSearch, setShowSearch] = useState(false);
    const [loadDuration, setLoadDuration] = useState<number | null>(null);
    const [tabMenuFor, setTabMenuFor] = useState<string | null | undefined>(null);     // id of the view with its (remove/delete) menu open
    const [menuUp, setMenuUp] = useState(false);            // open the dropdown upward if it doesn't fit below
    const [confirmDeleteView, setConfirmDeleteView] = useState<EmbedView | null>(null); // view pending deletion everywhere (ConfirmModal)
    const [deleteViewUsage, setDeleteViewUsage] = useState<ViewUsage | null>(null);
    const [renameView, setRenameView] = useState<EmbedView | null>(null);     // view pending rename (PromptModal)
    // Decides the dropdown's direction based on the space below the trigger.
    const decideMenuDir = (e: MouseEvent<HTMLElement>) => {
        try { const r = e.currentTarget.getBoundingClientRect(); setMenuUp(window.innerHeight - r.bottom < 300); } catch { setMenuUp(false); }
    };
    const [pinnedViewIds, setPinnedViewIds] = useState(() => readPinned(pageId, viewId));
    return { view, setView, rawRecords, setRawRecords, templates, setTemplates, tableViews, setTableViews, activeViewId, setActiveViewId, loading, setLoading, error, setError, reloadKey, setReloadKey, searchTerm, setSearchTerm, showSearch, setShowSearch, loadDuration, setLoadDuration, tabMenuFor, setTabMenuFor, menuUp, setMenuUp, confirmDeleteView, setConfirmDeleteView, deleteViewUsage, setDeleteViewUsage, renameView, setRenameView, decideMenuDir, pinnedViewIds, setPinnedViewIds };
}
export type EmbedState = ReturnType<typeof useEmbedState>;
