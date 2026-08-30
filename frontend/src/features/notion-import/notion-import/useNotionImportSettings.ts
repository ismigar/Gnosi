import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    abortNotionClone,
    connectNotionToken,
    disconnectNotionToken,
    fetchNotionCloneProgress,
    fetchNotionDatabaseSchema,
    fetchNotionDatabases,
    fetchNotionImportConfig,
    fetchNotionLinkedDatabases,
    fetchNotionLoosePages,
    fetchNotionOAuthStatus,
    fetchNotionStatus,
    fetchNotionVaultRegistry,
    saveNotionImportConfig,
    startNotionClone,
    verifyNotionClone,
    type NotionCloneProgress,
    type NotionCloneResult,
    type NotionDatabase,
    type NotionLinkedDatabases,
    type NotionVerification,
} from '../../../shared/api/notion-import';
import {
    createVault,
    deleteVault,
    fetchVaultCatalog,
    type VaultSummary,
} from '../../../shared/api/vaults';
import {
    errorMessage,
    loadNotionConfig,
    parseNotionConfig,
    persistNotionConfig,
    selectedLoosePageTypes,
    sortNotionItems,
    type LoosePage,
    type LoosePageKind,
    type NotionBusyAction,
    type NotionSchema,
    type NotionSchemaOverrides,
    type NotionStoredConfig,
} from './notionImportModel';


export interface NotionSchemaConfiguration {
    readonly database: NotionDatabase;
    readonly schema: NotionSchema;
}


export function useNotionImportSettings() {
    const { t } = useTranslation();
    const [saved] = useState(loadNotionConfig);
    const [connected, setConnected] = useState<boolean | null>(null);
    const [name, setName] = useState('');
    const [token, setToken] = useState('');
    const [busy, setBusy] = useState<NotionBusyAction>('');
    const [error, setError] = useState('');
    const [databases, setDatabases] = useState<NotionDatabase[]>([...saved.databases]);
    const [selected, setSelected] = useState(() => new Set(saved.selected));
    const [report, setReport] = useState<NotionCloneResult | null>(null);
    const [progress, setProgress] = useState<NotionCloneProgress | null>(null);
    const [confirmAbort, setConfirmAbort] = useState(false);
    const [vaults, setVaults] = useState<VaultSummary[]>([]);
    const [cloneVaultId, setCloneVaultId] = useState(saved.cloneVaultId);
    const [newVaultName, setNewVaultName] = useState(saved.newVaultName);
    const [usedVaultId, setUsedVaultId] = useState<string | null>(null);
    const [usedVaultName, setUsedVaultName] = useState('');
    const [destClone, setDestClone] = useState<{ tables: number } | null>(null);
    const [confirmDeleteClone, setConfirmDeleteClone] = useState(false);
    const [verification, setVerification] = useState<NotionVerification | null>(null);
    const [linkedDatabases, setLinkedDatabases] = useState<NotionLinkedDatabases | null>(null);
    const [mcpConnected, setMcpConnected] = useState(false);
    const [schemaOverrides, setSchemaOverrides] = useState<NotionSchemaOverrides>(
        saved.schemaOverrides,
    );
    const [schemaConfiguration, setSchemaConfiguration] =
        useState<NotionSchemaConfiguration | null>(null);
    const [loosePages, setLoosePages] = useState(saved.loosePages);
    const [loosePagesList, setLoosePagesList] = useState<LoosePage[]>([]);
    const [loosePageTypes, setLoosePageTypes] = useState(saved.loosePageTypes);
    const [looseSelected, setLooseSelected] = useState(() => new Set(saved.looseSelected));
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const pollResumeRef = useRef(false);
    const serverConfigLoadedRef = useRef(false);

    const applyConfig = useCallback((config: NotionStoredConfig): void => {
        setDatabases([...config.databases]);
        setSelected(new Set(config.selected));
        setSchemaOverrides(config.schemaOverrides);
        setCloneVaultId(config.cloneVaultId);
        setNewVaultName(config.newVaultName);
        setLoosePages(config.loosePages);
        setLoosePageTypes(config.loosePageTypes);
        setLooseSelected(new Set(config.looseSelected));
    }, []);

    useEffect(() => {
        let alive = true;
        void fetchNotionImportConfig().then(async ({ config }) => {
            if (!alive) return;
            if (config && Object.keys(config).length > 0) applyConfig(parseNotionConfig(config));
            else {
                const local = loadNotionConfig();
                if (Object.keys(local).length > 0) {
                    await saveNotionImportConfig(local).catch(() => undefined);
                }
            }
            serverConfigLoadedRef.current = true;
        }).catch(() => undefined);
        return () => {
            alive = false;
        };
    }, [applyConfig]);

    useEffect(() => {
        const config: NotionStoredConfig = {
            cloneVaultId,
            databases,
            loosePageTypes,
            loosePages,
            looseSelected: [...looseSelected],
            newVaultName,
            schemaOverrides,
            selected: [...selected],
        };
        persistNotionConfig(config);
        if (!serverConfigLoadedRef.current) return undefined;
        const timer = setTimeout(() => {
            void saveNotionImportConfig(config).catch(() => undefined);
        }, 800);
        return () => {
            clearTimeout(timer);
        };
    }, [
        cloneVaultId,
        databases,
        loosePageTypes,
        loosePages,
        looseSelected,
        newVaultName,
        schemaOverrides,
        selected,
    ]);

    const loadVaults = useCallback(async (): Promise<void> => {
        try {
            const { vaults: nextVaults } = await fetchVaultCatalog();
            setVaults(nextVaults);
            setCloneVaultId((current) => (
                current !== '__new__' && !nextVaults.some(({ id }) => id === current)
                    ? '__new__'
                    : current
            ));
        } catch {
            // Multi-vault is optional; the active vault remains available.
        }
    }, []);

    const loadStatus = useCallback(async (): Promise<void> => {
        const [notion, oauth] = await Promise.allSettled([
            fetchNotionStatus(),
            fetchNotionOAuthStatus(),
        ]);
        setConnected(notion.status === 'fulfilled' && notion.value.connected);
        setMcpConnected(oauth.status === 'fulfilled' && oauth.value.connected);
        await loadVaults();
    }, [loadVaults]);

    useEffect(() => {
        void Promise.resolve().then(loadStatus);
    }, [loadStatus]);

    useEffect(() => {
        const oauthResult = new URLSearchParams(window.location.search).get('notion_mcp');
        if (!oauthResult) return;
        void Promise.resolve().then(loadStatus);
        const url = new URL(window.location.href);
        url.searchParams.delete('notion_mcp');
        window.history.replaceState({}, '', url.toString());
    }, [loadStatus]);

    useEffect(() => {
        let alive = true;
        if (
            busy === 'clone'
            || cloneVaultId === '__new__'
            || !vaults.some(({ id }) => id === cloneVaultId)
        ) return undefined;
        void fetchNotionVaultRegistry(cloneVaultId).then(({ tables }) => {
            if (alive) setDestClone(tables?.length ? { tables: tables.length } : null);
        }).catch(() => {
            if (alive) setDestClone(null);
        });
        return () => {
            alive = false;
        };
    }, [busy, cloneVaultId, vaults]);

    const fetchLoose = useCallback(async (): Promise<void> => {
        setBusy('loose');
        setError('');
        try {
            const { pages } = await fetchNotionLoosePages();
            const nextPages = sortNotionItems(pages);
            const ids = new Set(nextPages.map(({ id }) => id));
            setLoosePagesList(nextPages);
            setLoosePageTypes((current) => Object.fromEntries(
                nextPages.map(({ id }) => [id, current[id] ?? 'wiki']),
            ));
            setLooseSelected((current) => new Set([...current].filter((id) => ids.has(id))));
        } catch (caught: unknown) {
            setError(errorMessage(caught));
        } finally {
            setBusy('');
        }
    }, []);

    useEffect(() => {
        if (connected && loosePages) void Promise.resolve().then(fetchLoose);
    }, [connected, fetchLoose, loosePages]);

    const stopProgressPoll = useCallback((): void => {
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = null;
    }, []);

    const startProgressPoll = useCallback((resume: boolean): void => {
        pollResumeRef.current = resume;
        stopProgressPoll();
        pollRef.current = setInterval(() => {
            void fetchNotionCloneProgress().then((nextProgress) => {
                setProgress(nextProgress);
                if (pollResumeRef.current && nextProgress.vault_id) {
                    setUsedVaultId(nextProgress.vault_id);
                }
                if (pollResumeRef.current && !nextProgress.running) {
                    stopProgressPoll();
                    setBusy('');
                    setProgress(null);
                    setReport({
                        attachments: nextProgress.attachments,
                        errors: [],
                        pages: nextProgress.pages,
                        status: 'success',
                        tables: nextProgress.tables,
                        truncated: false,
                        views: nextProgress.views,
                        warnings: [],
                    });
                }
            }).catch(() => undefined);
        }, 1_500);
    }, [stopProgressPoll]);

    useEffect(() => {
        let alive = true;
        void fetchNotionCloneProgress().then((nextProgress) => {
            if (!alive) return;
            if (nextProgress.vault_id) setUsedVaultId(nextProgress.vault_id);
            if (nextProgress.running) {
                setBusy('clone');
                setProgress(nextProgress);
                startProgressPoll(true);
            }
        }).catch(() => undefined);
        return () => {
            alive = false;
            stopProgressPoll();
        };
    }, [startProgressPoll, stopProgressPoll]);

    const resolveCloneVault = async (): Promise<string> => {
        if (
            cloneVaultId !== '__new__'
            && vaults.some(({ id }) => id === cloneVaultId)
        ) return cloneVaultId;
        const result = await createVault(newVaultName.trim() || 'Notion');
        await loadVaults();
        setCloneVaultId(result.id);
        return result.id;
    };

    const runClone = async (): Promise<void> => {
        setBusy('clone');
        setError('');
        setReport(null);
        let vaultId: string;
        try {
            vaultId = await resolveCloneVault();
        } catch (caught: unknown) {
            setError(t('settings.notion.err_prepare_vault', {
                defaultValue: "Couldn't prepare the destination vault: {{detail}}",
                detail: errorMessage(caught),
            }));
            setBusy('');
            return;
        }
        setUsedVaultId(vaultId);
        setUsedVaultName(cloneVaultId === '__new__'
            ? newVaultName.trim() || 'Notion'
            : vaults.find(({ id }) => id === vaultId)?.name ?? '');
        setProgress({
            attachments: 0,
            collected: 0,
            done: 0,
            pages: 0,
            pages_total: 0,
            phase: 'starting',
            running: true,
            tables: 0,
            tables_total: 0,
            total: 0,
            vault_id: vaultId,
            views: 0,
        });
        startProgressPoll(false);
        try {
            setReport(await startNotionClone({
                database_ids: databases.length > 0 ? [...selected] : null,
                loose_page_types: selectedLoosePageTypes(
                    loosePages,
                    looseSelected,
                    loosePageTypes,
                ),
                schema_overrides: Object.keys(schemaOverrides).length > 0
                    ? schemaOverrides
                    : null,
                target_folder: '',
            }, vaultId));
        } catch (caught: unknown) {
            setError(errorMessage(caught));
        } finally {
            setBusy('');
            stopProgressPoll();
            setProgress(null);
        }
    };

    const runVerify = async (): Promise<void> => {
        setBusy('verify');
        setError('');
        setVerification(null);
        const vaultId = usedVaultId ?? (
            cloneVaultId !== '__new__' && vaults.some(({ id }) => id === cloneVaultId)
                ? cloneVaultId
                : null
        );
        if (!vaultId) {
            setError(t('settings.notion.err_unknown_clone_vault', {
                defaultValue: "I don't know which vault the clone is in. Switch to the clone's vault and verify again.",
            }));
            setBusy('');
            return;
        }
        try {
            setVerification(await verifyNotionClone({
                database_ids: databases.length > 0 ? [...selected] : null,
                target_folder: '',
            }, vaultId));
        } catch (caught: unknown) {
            setError(errorMessage(caught));
        } finally {
            setBusy('');
        }
    };

    return {
        actions: {
            abortClone: async (): Promise<void> => {
                setConfirmAbort(false);
                try {
                    await abortNotionClone();
                    setProgress((current) => current
                        ? { ...current, phase: 'cancelled' }
                        : current);
                } catch (caught: unknown) {
                    setError(errorMessage(caught));
                }
            },
            checkLinked: async (): Promise<void> => {
                setBusy('linked'); setError(''); setLinkedDatabases(null);
                try { setLinkedDatabases(await fetchNotionLinkedDatabases()); }
                catch (caught: unknown) { setError(errorMessage(caught)); }
                finally { setBusy(''); }
            },
            connect: async (): Promise<void> => {
                setBusy('token'); setError('');
                try {
                    const result = await connectNotionToken(token.trim());
                    setName(result.name || 'Notion'); setConnected(true); setToken('');
                } catch (caught: unknown) { setError(errorMessage(caught)); }
                finally { setBusy(''); }
            },
            deleteClone: async (): Promise<void> => {
                setConfirmDeleteClone(false);
                if (cloneVaultId === '__new__') return;
                setBusy('delclone'); setError('');
                try {
                    await deleteVault(cloneVaultId, true);
                    setDestClone(null); setReport(null); setVerification(null);
                    setUsedVaultId(null); setCloneVaultId('__new__');
                    await loadVaults();
                } catch (caught: unknown) { setError(errorMessage(caught)); }
                finally { setBusy(''); }
            },
            disconnect: async (): Promise<void> => {
                setBusy('token');
                try {
                    await disconnectNotionToken();
                    setConnected(false); setDatabases([]); setReport(null);
                } catch (caught: unknown) { setError(errorMessage(caught)); }
                finally { setBusy(''); }
            },
            fetchLoose,
            listDatabases: async (): Promise<void> => {
                setBusy('list'); setError(''); setReport(null);
                try {
                    const next = (await fetchNotionDatabases()).databases;
                    const previousIds = new Set(databases.map(({ id }) => id));
                    setSelected((current) => new Set(next
                        .filter(({ id }) => !previousIds.has(id) || current.has(id))
                        .map(({ id }) => id)));
                    setDatabases(sortNotionItems(next));
                } catch (caught: unknown) { setError(errorMessage(caught)); }
                finally { setBusy(''); }
            },
            openSchema: async (database: NotionDatabase): Promise<void> => {
                setBusy(`schema:${database.id}`); setError('');
                try {
                    const result = await fetchNotionDatabaseSchema(database.id);
                    setSchemaConfiguration({
                        database,
                        schema: schemaOverrides[database.id] ?? result.schema,
                    });
                } catch (caught: unknown) { setError(errorMessage(caught)); }
                finally { setBusy(''); }
            },
            runClone,
            runVerify,
        },
        dialogs: {
            confirmAbort,
            confirmDeleteClone,
            schemaConfiguration,
            setConfirmAbort,
            setConfirmDeleteClone,
            setSchemaConfiguration,
        },
        setters: {
            setCloneVaultId,
            setLoosePageTypes,
            setLoosePages,
            setLooseSelected,
            setNewVaultName,
            setSchemaOverrides,
            setSelected,
            setToken,
        },
        state: {
            busy,
            cloneVaultId,
            connected,
            databases,
            destClone,
            error,
            linkedDbs: linkedDatabases,
            loosePageTypes,
            loosePages,
            loosePagesList,
            looseSelected,
            mcpConnected,
            name,
            newVaultName,
            progress,
            report,
            schemaOverrides,
            selected,
            token,
            usedVaultName,
            vaults,
            verify: verification,
        },
    };
}


export type NotionImportViewModel = ReturnType<typeof useNotionImportSettings>;
