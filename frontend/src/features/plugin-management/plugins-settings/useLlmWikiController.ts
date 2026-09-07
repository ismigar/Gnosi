import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { logError } from '../../../shared/notifications/notifyError';
import { apiErrorDetail } from '../../../shared/api/errors';
import { fetchBrainSuggestions } from '../../../shared/api/brain';
import {
    createPluginLlmWikiBrain,
    runPluginLlmWikiMaintenance,
    savePluginLlmWikiConfig,
    type PluginLlmWikiMaintenanceResponse,
    type PluginLlmWikiSettingsResponse,
} from '../../../shared/api/plugins';
import { loadLlmWikiSettings } from './loadLlmWikiSettings';
import { normalizeVaultTables, type VaultTable } from './pluginSettingsModel';
import {
    EMPTY_LLM_WIKI_DRAFT,
    normalizeLlmWikiDraft,
    serializeLlmWikiDraft,
    type LlmWikiController,
    type LlmWikiDraft,
} from './llmWikiModel';

const AUTOSAVE_DELAY_MS = 600;

export function useLlmWikiController(): LlmWikiController {
    const { t } = useTranslation();
    const [tables, setTables] = useState<readonly VaultTable[]>([]);
    const [draft, setDraftState] = useState<LlmWikiDraft>(EMPTY_LLM_WIKI_DRAFT);
    const [serverState, setServerState] = useState<PluginLlmWikiSettingsResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [confirmCreate, setConfirmCreate] = useState(false);
    const [lint, setLint] = useState<PluginLlmWikiMaintenanceResponse['lint'] | null>(null);
    const [lintBusy, setLintBusy] = useState(false);
    const [semanticBusy, setSemanticBusy] = useState(false);
    const [pendingSuggestions, setPendingSuggestions] = useState(0);
    const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const persistedDraftRef = useRef('');
    const failedDraftRef = useRef('');
    const latestDraftRef = useRef(draft);

    useEffect(() => {
        latestDraftRef.current = draft;
    }, [draft]);

    const errorMessage = useCallback((key: string, fallback: string): string => (
        t(`settings.plugins.${key}`, { defaultValue: fallback })
    ), [t]);

    const reload = useCallback(async (): Promise<void> => {
        setLoading(true);
        setError('');
        try {
            const [records, state] = await loadLlmWikiSettings();
            setTables(normalizeVaultTables(records));
            const normalized = normalizeLlmWikiDraft(state.config);
            persistedDraftRef.current = JSON.stringify(serializeLlmWikiDraft(normalized));
            setDraftState(normalized);
            setServerState(state);
        } catch (loadError) {
            setError(apiErrorDetail(loadError, errorMessage('llm_wiki_load_error', 'The configuration could not be loaded. Please retry.')));
        } finally {
            setLoading(false);
        }
    }, [errorMessage]);

    useEffect(() => {
        const controller = new AbortController();
        void fetchBrainSuggestions(controller.signal).then(suggestions => {
            if (!controller.signal.aborted) setPendingSuggestions(suggestions.suggestions.length);
        }).catch(() => { /* Suggestions must not block configuration. */ });
        return () => { controller.abort(); };
    }, []);

    useEffect(() => {
        void Promise.resolve().then(reload);
    }, [reload]);

    const save = useCallback(async (nextDraft: LlmWikiDraft): Promise<void> => {
        const payload = serializeLlmWikiDraft(nextDraft);
        const signature = JSON.stringify(payload);
        setBusy(true);
        setError('');
        try {
            const response = await savePluginLlmWikiConfig(payload);
            failedDraftRef.current = '';
            setServerState(response);
            const normalized = normalizeLlmWikiDraft(response.config);
            persistedDraftRef.current = JSON.stringify(serializeLlmWikiDraft(normalized));
            if (JSON.stringify(serializeLlmWikiDraft(latestDraftRef.current)) === signature) {
                setDraftState(normalized);
            }
        } catch (saveError) {
            failedDraftRef.current = signature;
            logError('llm-wiki.save-config', saveError);
            setError(apiErrorDetail(saveError, errorMessage('llm_wiki_save_error', 'The configuration could not be saved.')));
        } finally {
            setBusy(false);
        }
    }, [errorMessage]);

    useEffect(() => {
        if (loading || busy) return undefined;
        const payload = serializeLlmWikiDraft(draft);
        const isComplete = Boolean(draft.brain_table_id) && draft.source_tables.length > 0;
        const signature = JSON.stringify(payload);
        if (!isComplete || signature === persistedDraftRef.current || signature === failedDraftRef.current) return undefined;
        autosaveTimerRef.current = setTimeout(() => {
            autosaveTimerRef.current = null;
            void save(draft);
        }, AUTOSAVE_DELAY_MS);
        return () => {
            if (autosaveTimerRef.current) {
                clearTimeout(autosaveTimerRef.current);
                autosaveTimerRef.current = null;
            }
        };
    }, [busy, draft, loading, save]);

    useEffect(() => () => {
        if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    }, []);

    const runMaintenance = async (semantic: boolean): Promise<void> => {
        if (semantic) setSemanticBusy(true);
        else setLintBusy(true);
        setError('');
        try {
            const response = await runPluginLlmWikiMaintenance(semantic);
            setLint(response.lint);
            if (semantic) setPendingSuggestions(response.suggestions_pending);
        } catch (maintenanceError) {
            logError(semantic ? 'llm-wiki.semantic-audit' : 'llm-wiki.maintenance', maintenanceError);
            setError(errorMessage('llm_wiki_error', 'The Brain could not be updated.'));
        } finally {
            if (semantic) setSemanticBusy(false);
            else setLintBusy(false);
        }
    };

    const createBrain = async (): Promise<void> => {
        setBusy(true);
        setError('');
        try {
            await createPluginLlmWikiBrain(draft.ui_locale ?? 'en');
            setConfirmCreate(false);
            await reload();
        } catch (createError) {
            logError('llm-wiki.create-brain', createError);
            setError(errorMessage('llm_wiki_create_error', 'The Brain table could not be created.'));
        } finally {
            setBusy(false);
        }
    };

    const brainTable = useMemo(() => (
        tables.find((table) => table.id === draft.brain_table_id) ?? null
    ), [draft.brain_table_id, tables]);

    return {
        brainTable,
        busy,
        confirmCreate,
        createBrain,
        draft,
        error,
        lint,
        lintBusy,
        loading,
        pendingSuggestions,
        runLint: () => runMaintenance(false),
        retrySave: () => save(latestDraftRef.current),
        retryLoad: reload,
        runSemanticAudit: () => runMaintenance(true),
        semanticBusy,
        serverState,
        setConfirmCreate,
        setDraft: setDraftState,
        tables,
    };
}
