import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { deleteCredential, fetchCredentials, saveCredential } from '../../../../shared/api/credentials';
import { apiErrorDetail } from '../../../../shared/api/errors';
import {
    cancelLiteratureSynchronization,
    clearReferenceTable,
    createLiteratureRepository,
    createReferenceTable,
    deleteLiteratureRepository,
    fetchLiteratureConfiguration,
    fetchReferenceTable,
    resumeLiteratureSynchronization,
    setReferenceTable as saveReferenceTableDesignation,
    startLiteratureSynchronization,
    testLiteratureRepository,
    updateLiteratureConfiguration,
    updateLiteratureRepository,
} from '../../../../shared/api/literature-resources';
import type {
    LiteratureConfiguration,
    LiteratureConfigurationPatch,
    LiteratureSource,
    ReferenceTableStatus,
} from '../../../../shared/api/literature-resources';
import { fetchVaultTables } from '../../../../shared/api/vaults';
import { logError } from '../../../../shared/notifications/notifyError';
import {
    emptyRepositoryDraft,
    parseStaticFilters,
    repositoryDraftFromSource,
    repositoryPayload,
    scrollCredentialIntoView,
    sourceCredentialKey,
    staticFiltersText,
    synchronizationActive,
} from './resourcesPluginConfigModel';
import type { RepositoryDraft } from './resourcesPluginConfigModel';
import type {
    CredentialFeedback,
    ResourcesPluginConfigController,
    ResourcesTableOption,
} from './resourcesPluginConfigTypes';

const EMPTY_CONFIGURATION: LiteratureConfiguration = {
    ai_agent_id: '',
    ai_agents: [],
    contact_email: '',
    hidden_sources: [],
    source_defaults: {},
    sources: [],
};

const EMPTY_FEEDBACK: CredentialFeedback = { key: '', message: '', isError: false };

function tableOptions(records: Awaited<ReturnType<typeof fetchVaultTables>>): ResourcesTableOption[] {
    const options: ResourcesTableOption[] = [];
    for (const record of records) {
        const id = record.id;
        if (typeof id !== 'string' || !id) continue;
        const name = record.name;
        options.push({ id, name: typeof name === 'string' && name ? name : id });
    }
    return options;
}

export function useResourcesPluginConfig(): ResourcesPluginConfigController {
    const { t } = useTranslation();
    const [configuration, setConfiguration] = useState(EMPTY_CONFIGURATION);
    const [contactEmailInput, setContactEmailInput] = useState('');
    const isEditingEmailRef = useRef(false);
    const [tables, setTables] = useState<ResourcesTableOption[]>([]);
    const [referenceTable, setReferenceTable] = useState<ReferenceTableStatus>({
        table_id: '',
        configured: false,
    });
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState('');
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [repository, setRepository] = useState<RepositoryDraft>(emptyRepositoryDraft);
    const [repositoryStaticFilters, setRepositoryStaticFilters] = useState('');
    const [showRepositoryForm, setShowRepositoryForm] = useState(false);
    const [deleteTarget, setDeleteTarget] = useState<LiteratureSource | null>(null);
    const [deleteIndex, setDeleteIndex] = useState(false);
    const [showCredentialsInline, setShowCredentialsInline] = useState(false);
    const [credentialsStatus, setCredentialsStatus] = useState<Record<string, boolean>>({});
    const [credentialsInputs, setCredentialsInputs] = useState<Record<string, string>>({});
    const [credentialsVisible, setCredentialsVisible] = useState<Record<string, boolean>>({});
    const [savingCredentialKey, setSavingCredentialKey] = useState('');
    const [credentialFeedback, setCredentialFeedback] = useState(EMPTY_FEEDBACK);
    const [highlightCredentialKey, setHighlightCredentialKey] = useState('');

    const loadCredentialsStatuses = useCallback(async (): Promise<void> => {
        try {
            const statuses = await fetchCredentials();
            const nextStatus: Record<string, boolean> = {};
            for (const item of statuses) nextStatus[item.key] = item.has_value;
            setCredentialsStatus(nextStatus);
        } catch (requestError) {
            logError('resources-plugin.credentials-load', requestError);
        }
    }, []);

    const reload = useCallback(async (silent = false): Promise<void> => {
        if (!silent) setLoading(true);
        try {
            const [nextConfiguration, nextTables, nextReference] = await Promise.all([
                fetchLiteratureConfiguration(),
                fetchVaultTables(),
                fetchReferenceTable(),
            ]);
            setConfiguration(nextConfiguration);
            if (!isEditingEmailRef.current) {
                setContactEmailInput(nextConfiguration.contact_email);
            }
            setTables(tableOptions(nextTables));
            setReferenceTable(nextReference);
            setError('');
        } catch (requestError) {
            logError('resources-plugin.configuration-load', requestError);
            setError(apiErrorDetail(requestError, t('literature.settings.load_error')));
        } finally {
            if (!silent) setLoading(false);
        }
    }, [t]);

    useEffect(() => {
        void Promise.resolve().then(() => reload());
    }, [reload]);

    useEffect(() => {
        if (!showCredentialsInline) return;
        void Promise.resolve().then(loadCredentialsStatuses);
    }, [loadCredentialsStatuses, showCredentialsInline]);

    useEffect(() => {
        if (!configuration.sources.some(synchronizationActive)) return undefined;
        const timer = window.setInterval(() => {
            void reload(true);
        }, 2000);
        return () => {
            window.clearInterval(timer);
        };
    }, [configuration.sources, reload]);

    const saveConfiguration = async (
        patch: LiteratureConfigurationPatch,
    ): Promise<boolean> => {
        setBusy('configuration');
        setNotice('');
        try {
            const nextConfiguration = await updateLiteratureConfiguration(patch);
            setConfiguration(nextConfiguration);
            if (patch.contact_email !== undefined) {
                setContactEmailInput(nextConfiguration.contact_email);
                setNotice(t('literature.settings.contact_saved'));
            }
            setError('');
            return true;
        } catch (requestError) {
            logError('resources-plugin.configuration-save', requestError);
            setError(apiErrorDetail(requestError, t('literature.settings.save_error')));
            return false;
        } finally {
            setBusy('');
        }
    };

    const runSaveCredential = async (
        serviceKey: string,
        serviceName: string,
        customValue?: string,
    ): Promise<void> => {
        const value = (customValue ?? credentialsInputs[serviceKey] ?? '').trim();
        if (!value) return;
        setSavingCredentialKey(serviceKey);
        setCredentialFeedback(EMPTY_FEEDBACK);
        try {
            await saveCredential({ key: serviceKey, value });
            setCredentialsInputs((current) => ({ ...current, [serviceKey]: '' }));
            setCredentialFeedback({
                key: serviceKey,
                message: t('literature.settings.credential_saved', { name: serviceName }),
                isError: false,
            });
            await loadCredentialsStatuses();
            void reload(true);
        } catch (requestError) {
            logError(`resources-plugin.credential-save.${serviceKey}`, requestError);
            setCredentialFeedback({
                key: serviceKey,
                message: apiErrorDetail(requestError, t('literature.settings.save_error', 'Error')),
                isError: true,
            });
        } finally {
            setSavingCredentialKey('');
        }
    };

    const runDeleteCredential = async (
        serviceKey: string,
        serviceName: string,
    ): Promise<void> => {
        setSavingCredentialKey(serviceKey);
        setCredentialFeedback(EMPTY_FEEDBACK);
        try {
            await deleteCredential(serviceKey);
            setCredentialsInputs((current) => ({ ...current, [serviceKey]: '' }));
            setCredentialFeedback({
                key: serviceKey,
                message: t('literature.settings.credential_deleted', { name: serviceName }),
                isError: false,
            });
            await loadCredentialsStatuses();
            void reload(true);
        } catch (requestError) {
            logError(`resources-plugin.credential-delete.${serviceKey}`, requestError);
            setCredentialFeedback({
                key: serviceKey,
                message: apiErrorDetail(requestError, t('literature.settings.save_error', 'Error')),
                isError: true,
            });
        } finally {
            setSavingCredentialKey('');
        }
    };

    const runSelectReferenceTable = async (tableId: string): Promise<void> => {
        setBusy('reference');
        try {
            const nextReference = tableId
                ? await saveReferenceTableDesignation(tableId)
                : await clearReferenceTable();
            setReferenceTable(nextReference);
            setNotice(t('literature.settings.reference_saved'));
        } catch (requestError) {
            logError('resources-plugin.reference-save', requestError);
            setError(apiErrorDetail(requestError, t('literature.settings.reference_error')));
        } finally {
            setBusy('');
        }
    };

    const runCreateReference = async (): Promise<void> => {
        setBusy('reference');
        try {
            setReferenceTable(await createReferenceTable());
            await reload(true);
            setNotice(t('literature.settings.reference_created'));
        } catch (requestError) {
            logError('resources-plugin.reference-create', requestError);
            setError(apiErrorDetail(requestError, t('literature.settings.reference_error')));
        } finally {
            setBusy('');
        }
    };

    const runRestoreHiddenSources = async (): Promise<void> => {
        const restoredCount = configuration.sources.filter((source) => source.hidden).length;
        if (restoredCount === 0) return;
        const saved = await saveConfiguration({ hidden_sources: [] });
        if (saved) setNotice(t('literature.settings.sources_restored', { count: restoredCount }));
    };

    const runSaveRepository = async (): Promise<void> => {
        setBusy('repository');
        setError('');
        try {
            const payload = repositoryPayload(repository, parseStaticFilters(repositoryStaticFilters));
            if (repository.id) await updateLiteratureRepository(repository.id, payload);
            else await createLiteratureRepository(payload);
            setRepository(emptyRepositoryDraft());
            setRepositoryStaticFilters('');
            setShowRepositoryForm(false);
            setNotice(t('literature.settings.repository_saved'));
            await reload(true);
        } catch (requestError) {
            logError('resources-plugin.repository-save', requestError);
            setError(apiErrorDetail(requestError, t('literature.settings.repository_error')));
        } finally {
            setBusy('');
        }
    };

    const runTestRepository = async (): Promise<void> => {
        setBusy('test');
        try {
            const result = await testLiteratureRepository({
                ...repositoryPayload(repository, parseStaticFilters(repositoryStaticFilters)),
                id: repository.id,
                query: 'open science',
            });
            setNotice(t('literature.settings.test_ok', {
                count: result.count,
                latency: result.latency_ms,
            }));
            setError('');
        } catch (requestError) {
            logError('resources-plugin.repository-test', requestError);
            setError(apiErrorDetail(requestError, t('literature.settings.test_error')));
        } finally {
            setBusy('');
        }
    };

    const runConfirmDelete = async (): Promise<void> => {
        if (!deleteTarget) return;
        setBusy(`delete:${deleteTarget.id}`);
        try {
            await deleteLiteratureRepository(deleteTarget.id, deleteIndex);
            setDeleteTarget(null);
            setDeleteIndex(false);
            setNotice(t('literature.settings.repository_deleted'));
            await reload(true);
        } catch (requestError) {
            logError('resources-plugin.repository-delete', requestError);
            setError(apiErrorDetail(requestError, t('literature.settings.repository_delete_error')));
        } finally {
            setBusy('');
        }
    };

    const runSynchronization = async (
        source: LiteratureSource,
        action: 'cancel' | 'resume' | 'start',
        full = false,
    ): Promise<void> => {
        setBusy(`sync:${source.id}`);
        try {
            if (action === 'cancel') await cancelLiteratureSynchronization(source.id);
            else if (action === 'resume') await resumeLiteratureSynchronization(source.id);
            else await startLiteratureSynchronization(source.id, full);
            const noticeKey = action === 'cancel'
                ? 'sync_cancel_requested'
                : action === 'resume' ? 'sync_resumed' : 'sync_started';
            setNotice(t(`literature.settings.${noticeKey}`));
            await reload(true);
        } catch (requestError) {
            logError(`resources-plugin.synchronization-${action}`, requestError);
            setError(apiErrorDetail(requestError, t('literature.settings.sync_error')));
        } finally {
            setBusy('');
        }
    };

    const visibleSources = useMemo(
        () => configuration.sources.filter((source) => !source.hidden),
        [configuration.sources],
    );
    const hiddenSourceCount = configuration.sources.filter((source) => source.hidden).length;

    return {
        busy,
        cancelSynchronization: (source) => { void runSynchronization(source, 'cancel'); },
        closeDeleteConfirmation: () => { setDeleteTarget(null); setDeleteIndex(false); },
        closeRepositoryForm: () => { setShowRepositoryForm(false); },
        confirmDelete: () => { void runConfirmDelete(); },
        commitContactEmail: () => {
            isEditingEmailRef.current = false;
            const trimmed = contactEmailInput.trim();
            if (trimmed !== configuration.contact_email) {
                void saveConfiguration({ contact_email: trimmed });
            }
        },
        configuration,
        contactEmailInput,
        createReference: () => { void runCreateReference(); },
        credentialFeedback,
        credentialsInputs,
        credentialsStatus,
        credentialsVisible,
        deleteCredential: (serviceKey, serviceName) => { void runDeleteCredential(serviceKey, serviceName); },
        deleteIndex,
        deleteTarget,
        editRepository: (source) => {
            const nextRepository = repositoryDraftFromSource(source);
            setRepository(nextRepository);
            setRepositoryStaticFilters(staticFiltersText(nextRepository.static_filters));
            setShowRepositoryForm(true);
        },
        error,
        focusCredentialForSource: (source) => {
            const credentialKey = sourceCredentialKey(source);
            setShowCredentialsInline(true);
            setHighlightCredentialKey(credentialKey);
            if (credentialKey) window.setTimeout(() => { scrollCredentialIntoView(credentialKey); }, 60);
        },
        hiddenSourceCount,
        highlightCredentialKey,
        loading,
        markContactEmailEditing: () => { isEditingEmailRef.current = true; },
        notice,
        openNewRepository: () => {
            setRepository(emptyRepositoryDraft());
            setRepositoryStaticFilters('');
            setShowRepositoryForm((value) => !value);
        },
        referenceTable,
        repository,
        repositoryStaticFilters,
        requestDelete: setDeleteTarget,
        restoreHiddenSources: () => { void runRestoreHiddenSources(); },
        resumeSynchronization: (source) => { void runSynchronization(source, 'resume'); },
        saveCredential: (serviceKey, serviceName, customValue) => { void runSaveCredential(serviceKey, serviceName, customValue); },
        saveRepository: () => { void runSaveRepository(); },
        savingCredentialKey,
        selectReferenceTable: (tableId) => { void runSelectReferenceTable(tableId); },
        setContactEmailInput,
        setDeleteIndex,
        setRepositoryField: (key, value) => {
            setRepository((current) => ({ ...current, [key]: value }));
        },
        setRepositoryMapping: (field, value) => {
            setRepository((current) => ({
                ...current,
                mapping: { ...current.mapping, [field]: value },
            }));
        },
        setRepositoryStaticFilters,
        showCredentialsInline,
        showRepositoryForm,
        synchronize: (source, full = false) => { void runSynchronization(source, 'start', full); },
        tables,
        testRepository: () => { void runTestRepository(); },
        toggleCredentialVisibility: (serviceKey) => {
            setCredentialsVisible((current) => ({
                ...current,
                [serviceKey]: !current[serviceKey],
            }));
        },
        toggleCredentials: () => {
            setShowCredentialsInline((current) => !current);
            setHighlightCredentialKey('');
        },
        toggleHidden: (source, hidden) => {
            const values = new Set(configuration.hidden_sources);
            if (hidden) values.add(source.id); else values.delete(source.id);
            void saveConfiguration({ hidden_sources: Array.from(values) });
        },
        toggleSource: (source, enabled) => {
            void saveConfiguration({
                source_defaults: { ...configuration.source_defaults, [source.id]: enabled },
            });
        },
        updateCredentialInput: (serviceKey, value) => {
            setCredentialsInputs((current) => ({ ...current, [serviceKey]: value }));
        },
        visibleSources,
    };
}
