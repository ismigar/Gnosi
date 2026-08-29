import { useEffect, useMemo, useReducer } from 'react';

import {
    comparisonRoutesForMode,
    comparisonRouteToRegistryEntry,
    matchingRegistryIndexes,
    type ResolvedComparisonRoute,
} from '../lib/modelComparisonRegistry';
import { logError } from '../lib/notifyError';
import {
    fetchAiModelCatalog,
    fetchAiModelComparison,
    fetchAiModels,
    setAiProviderCredentials,
    setAiProviderStatus,
    updateAiModels,
    type AiModelCatalog,
    type AiModelCatalogProvider,
    type AiModelComparison,
    type AiModelComparisonEntry,
    type AiModelRegistryEntry,
} from '../shared/api/ai';
import { emitAppEvent } from '../shared/platform/app-events';
import {
    comparisonProvidersById,
    isAbortError,
    modelComparisonErrorCode,
    type ComparisonSetupMode,
    type ModelActionMessage,
    type ModelRegistryState,
    type ModelSetupState,
} from './modelComparison';


interface ModelComparisonDataState {
    readonly actionMessage: ModelActionMessage | null;
    readonly apiKeyInput: string;
    readonly busyModelId: string;
    readonly catalog: AiModelCatalog | null;
    readonly configurationError: string;
    readonly configurationLoading: boolean;
    readonly errorCode: string;
    readonly fallbackNoticeDismissed: boolean;
    readonly feed: AiModelComparison | null;
    readonly loading: boolean;
    readonly registry: ModelRegistryState;
    readonly requestVersion: number;
    readonly savingApiKey: boolean;
    readonly setup: ModelSetupState | null;
}


type ModelComparisonDataAction =
    | { readonly type: 'catalog-connected'; readonly providerId: string; readonly savedKey: boolean }
    | { readonly type: 'configuration-failed' }
    | { readonly type: 'configuration-loaded'; readonly catalog: AiModelCatalog; readonly registry: ModelRegistryState }
    | { readonly type: 'configuration-started' }
    | { readonly type: 'dismiss-fallback' }
    | { readonly type: 'feed-failed'; readonly errorCode: string }
    | { readonly type: 'feed-loaded'; readonly feed: AiModelComparison }
    | { readonly type: 'feed-started' }
    | { readonly type: 'patch-setup'; readonly patch: Partial<ModelSetupState> }
    | { readonly type: 'registry-saved'; readonly models: readonly AiModelRegistryEntry[] }
    | { readonly type: 'retry' }
    | { readonly type: 'set-action-message'; readonly message: ModelActionMessage | null }
    | { readonly type: 'set-api-key-input'; readonly value: string }
    | { readonly type: 'set-busy-model'; readonly modelId: string }
    | { readonly type: 'set-saving-api-key'; readonly value: boolean }
    | { readonly type: 'set-setup'; readonly setup: ModelSetupState | null };


const INITIAL_DATA_STATE: ModelComparisonDataState = {
    actionMessage: null,
    apiKeyInput: '',
    busyModelId: '',
    catalog: null,
    configurationError: '',
    configurationLoading: false,
    errorCode: '',
    fallbackNoticeDismissed: false,
    feed: null,
    loading: false,
    registry: { budget: {}, models: [] },
    requestVersion: 0,
    savingApiKey: false,
    setup: null,
};


function modelComparisonDataReducer(
    state: ModelComparisonDataState,
    action: ModelComparisonDataAction,
): ModelComparisonDataState {
    switch (action.type) {
        case 'catalog-connected':
            if (!state.catalog) return state;
            return {
                ...state,
                catalog: {
                    ...state.catalog,
                    providers: state.catalog.providers.map((provider) => (
                        provider.id === action.providerId
                            ? {
                                ...provider,
                                connected: true,
                                enabled: true,
                                has_api_key: provider.has_api_key || action.savedKey,
                            }
                            : provider
                    )),
                },
            };
        case 'configuration-failed':
            return {
                ...state,
                configurationError: 'configuration_load_error',
                configurationLoading: false,
            };
        case 'configuration-loaded':
            return {
                ...state,
                catalog: action.catalog,
                configurationError: '',
                configurationLoading: false,
                registry: action.registry,
            };
        case 'configuration-started':
            return {
                ...state,
                configurationError: '',
                configurationLoading: true,
            };
        case 'dismiss-fallback':
            return { ...state, fallbackNoticeDismissed: true };
        case 'feed-failed':
            return {
                ...state,
                errorCode: action.errorCode,
                feed: null,
                loading: false,
            };
        case 'feed-loaded':
            return {
                ...state,
                errorCode: '',
                feed: action.feed,
                loading: false,
            };
        case 'feed-started':
            return {
                ...state,
                errorCode: '',
                fallbackNoticeDismissed: false,
                loading: true,
            };
        case 'patch-setup':
            return state.setup
                ? { ...state, setup: { ...state.setup, ...action.patch } }
                : state;
        case 'registry-saved':
            return {
                ...state,
                registry: { ...state.registry, models: action.models },
            };
        case 'retry':
            return { ...state, requestVersion: state.requestVersion + 1 };
        case 'set-action-message':
            return { ...state, actionMessage: action.message };
        case 'set-api-key-input':
            return { ...state, apiKeyInput: action.value };
        case 'set-busy-model':
            return { ...state, busyModelId: action.modelId };
        case 'set-saving-api-key':
            return { ...state, savingApiKey: action.value };
        case 'set-setup':
            return { ...state, setup: action.setup };
    }
}


const signalIsAborted = (signal: AbortSignal): boolean => signal.aborted;


export interface ModelComparisonDataController {
    readonly activateModel: () => Promise<void>;
    readonly beginActivation: (model: AiModelComparisonEntry) => void;
    readonly changeSetupMode: (mode: ComparisonSetupMode) => void;
    readonly changeSetupProvider: (providerId: string) => void;
    readonly closeSetup: () => void;
    readonly deactivateModel: (model: AiModelComparisonEntry) => Promise<void>;
    readonly dismissFallback: () => void;
    readonly providersById: Readonly<Record<string, AiModelCatalogProvider>>;
    readonly retry: () => void;
    readonly routesForMode: (
        model: AiModelComparisonEntry,
        mode: ComparisonSetupMode,
    ) => readonly ResolvedComparisonRoute[];
    readonly saveArtificialAnalysisApiKey: () => Promise<void>;
    readonly setApiKeyInput: (value: string) => void;
    readonly setSetupApiKey: (value: string) => void;
    readonly setSetupBaseUrl: (value: string) => void;
    readonly state: ModelComparisonDataState;
}


export function useModelComparisonData(
    isOpen: boolean,
): ModelComparisonDataController {
    const [state, dispatch] = useReducer(
        modelComparisonDataReducer,
        INITIAL_DATA_STATE,
    );

    useEffect(() => {
        if (!isOpen) return undefined;
        const controller = new AbortController();
        void Promise.resolve().then(async () => {
            if (signalIsAborted(controller.signal)) return;
            dispatch({ type: 'feed-started' });
            try {
                const feed = await fetchAiModelComparison(controller.signal);
                if (!signalIsAborted(controller.signal)) {
                    dispatch({ type: 'feed-loaded', feed });
                }
            } catch (error: unknown) {
                if (!signalIsAborted(controller.signal) && !isAbortError(error)) {
                    logError('ai-model-comparison-feed', error);
                    dispatch({
                        errorCode: modelComparisonErrorCode(error),
                        type: 'feed-failed',
                    });
                }
            }
        });
        return () => {
            controller.abort();
        };
    }, [isOpen, state.requestVersion]);

    useEffect(() => {
        if (!isOpen) return undefined;
        const controller = new AbortController();
        void Promise.resolve().then(async () => {
            if (signalIsAborted(controller.signal)) return;
            dispatch({ type: 'configuration-started' });
            try {
                const [registryPayload, catalog] = await Promise.all([
                    fetchAiModels(controller.signal),
                    fetchAiModelCatalog(undefined, controller.signal),
                ]);
                if (!signalIsAborted(controller.signal)) {
                    dispatch({
                        catalog,
                        registry: {
                            budget: registryPayload.budget,
                            models: registryPayload.configured_models,
                        },
                        type: 'configuration-loaded',
                    });
                }
            } catch (error: unknown) {
                if (!signalIsAborted(controller.signal) && !isAbortError(error)) {
                    logError('ai-model-comparison-configuration', error);
                    dispatch({ type: 'configuration-failed' });
                }
            }
        });
        return () => {
            controller.abort();
        };
    }, [isOpen, state.requestVersion]);

    const providersById = useMemo(
        () => comparisonProvidersById(state.catalog),
        [state.catalog],
    );
    const routesForMode = (
        model: AiModelComparisonEntry,
        mode: ComparisonSetupMode,
    ): readonly ResolvedComparisonRoute[] => comparisonRoutesForMode(
        model,
        state.catalog?.providers ?? [],
        mode,
    );
    const setupForMode = (
        model: AiModelComparisonEntry,
        mode: ComparisonSetupMode,
    ): ModelSetupState => {
        const routes = routesForMode(model, mode);
        const creator = model.creator.toLocaleLowerCase();
        const route = routes.find((candidate) => candidate.provider_connected)
            ?? routes.find((candidate) => (
                candidate.provider.toLocaleLowerCase() === creator
                || candidate.provider_name.toLocaleLowerCase().includes(creator)
            ))
            ?? routes[0]
            ?? null;
        const provider = route ? providersById[route.provider] : null;
        return {
            apiKey: '',
            baseUrl: provider?.base_url ?? provider?.api ?? '',
            error: '',
            mode,
            model,
            providerId: route?.provider ?? '',
        };
    };
    const saveRegistry = async (
        models: readonly AiModelRegistryEntry[],
    ): Promise<void> => {
        await updateAiModels({
            budget: { ...state.registry.budget },
            models: [...models],
        });
        dispatch({ models, type: 'registry-saved' });
        emitAppEvent('gnosi-ai-models-changed', {
            source: 'model-comparison',
        });
    };
    const saveArtificialAnalysisApiKey = async (): Promise<void> => {
        const apiKey = state.apiKeyInput.trim();
        if (!apiKey) return;
        dispatch({ type: 'set-saving-api-key', value: true });
        try {
            await setAiProviderCredentials('artificial_analysis', {
                api_key: apiKey,
                base_url: '',
            });
            dispatch({ type: 'set-api-key-input', value: '' });
            dispatch({ type: 'retry' });
        } catch (error: unknown) {
            logError('ai-model-comparison-credential', error);
            dispatch({ errorCode: 'credential_save_error', type: 'feed-failed' });
        } finally {
            dispatch({ type: 'set-saving-api-key', value: false });
        }
    };
    const beginActivation = (model: AiModelComparisonEntry): void => {
        dispatch({ message: null, type: 'set-action-message' });
        const mode = routesForMode(model, 'remote').length > 0
            ? 'remote'
            : routesForMode(model, 'local').length > 0
                ? 'local'
                : 'remote';
        dispatch({ setup: setupForMode(model, mode), type: 'set-setup' });
    };
    const changeSetupMode = (mode: ComparisonSetupMode): void => {
        if (!state.setup) return;
        dispatch({
            setup: setupForMode(state.setup.model, mode),
            type: 'set-setup',
        });
    };
    const changeSetupProvider = (providerId: string): void => {
        const provider = providersById[providerId];
        dispatch({
            patch: {
                apiKey: '',
                baseUrl: provider?.base_url ?? provider?.api ?? '',
                error: '',
                providerId,
            },
            type: 'patch-setup',
        });
    };
    const deactivateModel = async (
        model: AiModelComparisonEntry,
    ): Promise<void> => {
        const indexes = new Set(matchingRegistryIndexes(state.registry.models, model));
        if (indexes.size === 0) return;
        dispatch({ modelId: model.id, type: 'set-busy-model' });
        dispatch({ message: null, type: 'set-action-message' });
        try {
            const models = state.registry.models.map((entry, index) => (
                indexes.has(index) ? { ...entry, enabled: false } : entry
            ));
            await saveRegistry(models);
            dispatch({
                message: {
                    key: 'model_disabled',
                    model: model.name,
                    type: 'success',
                },
                type: 'set-action-message',
            });
        } catch (error: unknown) {
            logError('ai-model-comparison-disable', error);
            dispatch({
                message: { key: 'configuration_save_error', type: 'error' },
                type: 'set-action-message',
            });
        } finally {
            dispatch({ modelId: '', type: 'set-busy-model' });
        }
    };
    const activateModel = async (): Promise<void> => {
        const setup = state.setup;
        if (!setup) return;
        const provider = providersById[setup.providerId];
        const selectedRoute = routesForMode(setup.model, setup.mode)
            .find((route) => route.provider === setup.providerId);
        const needsApiKey = setup.mode === 'remote' && !provider?.has_api_key;
        if (!provider || !selectedRoute || (needsApiKey && !setup.apiKey.trim())) {
            return;
        }
        dispatch({ modelId: setup.model.id, type: 'set-busy-model' });
        dispatch({ patch: { error: '' }, type: 'patch-setup' });
        try {
            if (needsApiKey) {
                await setAiProviderCredentials(provider.id, {
                    api_key: setup.apiKey.trim(),
                    base_url: setup.baseUrl || provider.api || '',
                });
            }
            if (!provider.enabled || !provider.connected) {
                await setAiProviderStatus(provider.id, { enabled: true });
            }
            const existingIndex = state.registry.models.findIndex((entry) => (
                entry.provider === provider.id
                && entry.model_id === selectedRoute.model_id
            ));
            const newEntry: AiModelRegistryEntry =
                comparisonRouteToRegistryEntry(selectedRoute);
            const models = existingIndex >= 0
                ? state.registry.models.map((entry, index) => (
                    index === existingIndex
                        ? { ...entry, ...newEntry, enabled: true }
                        : entry
                ))
                : [...state.registry.models, newEntry];
            await saveRegistry(models);
            dispatch({
                providerId: provider.id,
                savedKey: needsApiKey,
                type: 'catalog-connected',
            });
            dispatch({
                message: {
                    key: 'model_enabled',
                    model: setup.model.name,
                    provider: provider.name,
                    type: 'success',
                },
                type: 'set-action-message',
            });
            dispatch({ setup: null, type: 'set-setup' });
        } catch (error: unknown) {
            logError('ai-model-comparison-enable', error);
            dispatch({
                patch: { error: 'configuration_save_error' },
                type: 'patch-setup',
            });
        } finally {
            dispatch({ modelId: '', type: 'set-busy-model' });
        }
    };

    return {
        activateModel,
        beginActivation,
        changeSetupMode,
        changeSetupProvider,
        closeSetup: () => {
            dispatch({ setup: null, type: 'set-setup' });
        },
        deactivateModel,
        dismissFallback: () => {
            dispatch({ type: 'dismiss-fallback' });
        },
        providersById,
        retry: () => {
            dispatch({ type: 'retry' });
        },
        routesForMode,
        saveArtificialAnalysisApiKey,
        setApiKeyInput: (value) => {
            dispatch({ type: 'set-api-key-input', value });
        },
        setSetupApiKey: (value) => {
            dispatch({ patch: { apiKey: value, error: '' }, type: 'patch-setup' });
        },
        setSetupBaseUrl: (value) => {
            dispatch({ patch: { baseUrl: value, error: '' }, type: 'patch-setup' });
        },
        state,
    };
}
