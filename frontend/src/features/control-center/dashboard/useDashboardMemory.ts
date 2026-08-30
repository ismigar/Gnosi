import {useCallback, useState} from 'react';
import {useTranslation} from 'react-i18next';
import toast from '../../../lib/toast';
import {useApi} from '../../../hooks/use-api';
import {deleteDirective, fetchAnalyticsOverview, fetchDirectiveAnalytics, fetchDirectiveContent, fetchTrapAnalytics, saveDirectiveContent, type AnalyticsOverview, type DirectiveAnalytics, type TrapAnalyticsPage} from '../../../shared/api/analytics';
import type {components} from '../../../generated/openapi';
import type {DashboardDirective} from './model';
export function useDashboardMemory() {
const {t} = useTranslation();
const {apiFetch} = useApi();
    const [approvedTools, setApprovedTools] = useState<DashboardDirective[]>([]);
    const [pendingTools, setPendingTools] = useState<components["schemas"]["ToolResponse"][]>([]);

    const [, setApprovedLoading] = useState(true);
    const [analytics, setAnalytics] = useState<AnalyticsOverview | null>(null);
    const [directives, setDirectives] = useState<DirectiveAnalytics[]>([]);
    const [directivesTotal, setDirectivesTotal] = useState(0);
    const [directivesPage, setDirectivesPage] = useState(0);
    const DIRECTIVES_LIMIT = 12;

    const [traps, setTraps] = useState<TrapAnalyticsPage["traps"]>([]);
    const [trapsTotal, setTrapsTotal] = useState(0);
    const [trapsPage, setTrapsPage] = useState(0);
    const TRAPS_LIMIT = 15;
    const [isTrapsModalOpen, setIsTrapsModalOpen] = useState(false);
    const [isTrapsLoading, setIsTrapsLoading] = useState(false);
    const [isDirectivesModalOpen, setIsDirectivesModalOpen] = useState(false);
    const [isDirectivesLoading, setIsDirectivesLoading] = useState(false);
    const [editingDirective, setEditingDirective] = useState<DashboardDirective | null>(null);
    const [isEditorSaving, setIsEditorSaving] = useState(false);
    const [editorContent, setEditorContent] = useState('');

    // States for the confirmation modals (replace window.confirm)
    const [confirmDeleteDirective, setConfirmDeleteDirective] = useState<DashboardDirective | null>(null); // directive to delete
    const [isToolsModalOpen, setIsToolsModalOpen] = useState(false);
    const fetchPendingTools = useCallback(async () => {
        try {
            const data = await apiFetch<components["schemas"]["ToolResponse"][]>('/api/tools/pending');
            setPendingTools(data);
        } catch { /* Retain the current view when a background request fails. */ }
    }, [apiFetch]);

    const fetchAnalytics = useCallback(async () => {
        try {
            const data = await fetchAnalyticsOverview();
            setAnalytics(data);
        } catch { /* Retain the current view when a background request fails. */ }
    }, []);
    const fetchApprovedTools = useCallback(async () => {
        await Promise.resolve();
        setApprovedLoading(true);
        try {
            const data = await fetchDirectiveAnalytics();
            const mature = data.directives.filter(d => d.path.includes('pipeline/skills/') && d.path.endsWith('SKILL.md'));
            setApprovedTools(mature);
        } catch { /* Retain the current view when a background request fails. */ } finally {
            setApprovedLoading(false);
        }
    }, []);
    const fetchTraps = useCallback(async (p = 0) => { await Promise.resolve();
        const page = typeof p === 'number' ? p : 0;
        setIsTrapsLoading(true);
        try {
            const offset = page * TRAPS_LIMIT;
            const data = await fetchTrapAnalytics({ limit: TRAPS_LIMIT, offset });
            {
                setTraps(data.traps);
                setTrapsTotal(data.total);
                setTrapsPage(page);
            }
        } catch { /* Retain the current view when a background request fails. */ } finally {
            setIsTrapsLoading(false);
        }
    }, []);

    const fetchDirectives = useCallback(async (p = 0) => { await Promise.resolve();
        const page = typeof p === 'number' ? p : 0;
        setIsDirectivesLoading(true);
        try {
            const offset = page * DIRECTIVES_LIMIT;
            const data = await fetchDirectiveAnalytics({ limit: DIRECTIVES_LIMIT, offset });
            {
                setDirectives(data.directives);
                setDirectivesTotal(data.total);
                setDirectivesPage(page);
            }
        } catch { /* Retain the current view when a background request fails. */ } finally {
            setIsDirectivesLoading(false);
        }
    }, []);

    const handleEditDirective = useCallback(async (directive: DashboardDirective) => {
        try {
            const data = await fetchDirectiveContent(directive.path);
            setEditorContent(data.content);
            setEditingDirective(directive);
        } catch {
            toast.error(t('dashboard.directive_load_error'));
        }
    }, [t]);

    const handleSaveDirective = useCallback(async () => {
        if (!editingDirective) return;
        setIsEditorSaving(true);
        try {
            await saveDirectiveContent({
                path: editingDirective.path,
                content: editorContent,
            });
            toast.success(t('dashboard.directive_saved'));
            setEditingDirective(null);
            void fetchDirectives(directivesPage);
            void fetchApprovedTools();
            void fetchAnalytics();
        } catch {
            toast.error(t('dashboard.directive_save_error'));
        } finally {
            setIsEditorSaving(false);
        }
    }, [editingDirective, editorContent, directivesPage, fetchDirectives, fetchApprovedTools, fetchAnalytics, t]);

    const handleDeleteDirective = (directive: DashboardDirective) => { setConfirmDeleteDirective(directive); };

    const doDeleteDirective = async () => {
        const directive = confirmDeleteDirective;
        setConfirmDeleteDirective(null);
        if (!directive) return;
        const isSkill = directive.path.includes("pipeline/skills");
        try {
            await deleteDirective(directive.path);
            toast.success(isSkill ? t('dashboard.skill_deleted') : t('dashboard.directive_deleted'));
            void fetchDirectives(directivesPage);
            void fetchApprovedTools();
            void fetchAnalytics();
        } catch {
            toast.error(isSkill ? t('dashboard.skill_delete_error') : t('dashboard.directive_delete_error'));
        }
    };

return {approvedTools, pendingTools, analytics, directives, directivesTotal, directivesPage, DIRECTIVES_LIMIT, traps, trapsTotal, trapsPage, TRAPS_LIMIT, isTrapsModalOpen, setIsTrapsModalOpen, isTrapsLoading, isDirectivesModalOpen, setIsDirectivesModalOpen, isDirectivesLoading, editingDirective, setEditingDirective, isEditorSaving, editorContent, setEditorContent, confirmDeleteDirective, setConfirmDeleteDirective, isToolsModalOpen, setIsToolsModalOpen, fetchPendingTools, fetchAnalytics, fetchApprovedTools, fetchTraps, fetchDirectives, handleEditDirective, handleSaveDirective, handleDeleteDirective, doDeleteDirective};
}
