import { GnosiApiError } from '../../shared/api/errors';
import { INITIAL_DATA_STATE, modelComparisonDataReducer, type ModelComparisonDataState } from './model-comparison/modelComparisonDataState';
import { useRegistryMutation } from './model-comparison/useRegistryMutation';
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';

import {
    comparisonRoutesForMode,
    comparisonRouteKey,
    comparisonRouteToRegistryEntry,
    matchingRegistryIndexes,
    type ResolvedComparisonRoute,
} from './model-comparison/modelComparisonRegistry';
import { logError } from '../../shared/notifications/notifyError';
import {
    fetchAiModelCatalog,
    fetchAiModelComparison,
    fetchAiModels,
    setAiProviderCredentials,
    setAiProviderStatus,
    validateAiProvider,
    type AiModelCatalogProvider,
    type AiModelComparisonEntry,
    type AiModelRegistryEntry,
} from '../../shared/api/ai';
import { emitAppEvent } from '../../shared/platform/app-events';
import {
    comparisonProvidersById,
    isAbortError,
    modelComparisonErrorCode,
    type ComparisonSetupMode,
    type ModelSetupState,
} from './modelComparison';


const signalIsAborted = (signal: AbortSignal): boolean => signal.aborted;


export interface ModelDetachConfirmation {
    readonly model: AiModelComparisonEntry;
    readonly provider: string;
    readonly revision: string;
    readonly agents: readonly { id: string; name: string }[];
    readonly routes: readonly { provider: string; model: string }[];
}

export interface ModelComparisonDataController {
    readonly detachConfirmation: ModelDetachConfirmation | null;
    readonly cancelDeactivation: () => void;
    readonly confirmDeactivation: () => Promise<void>;
    readonly beginActivation: (model: AiModelComparisonEntry, preferredProvider?: string) => void;
    readonly changeSetupMode: (mode: ComparisonSetupMode) => void;
    readonly changeSetupProvider: (providerId: string) => void;
    readonly closeSetup: () => void;
    readonly deactivateModel: (model: AiModelComparisonEntry, provider?: string) => Promise<void>;
    readonly testSetupConnection: () => Promise<void>;
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
    onDetached?: (routes: readonly { provider: string; model: string }[]) => void,
): ModelComparisonDataController {
    const [detachConfirmation, setDetachConfirmation] = useState<ModelDetachConfirmation | null>(null);
    const activationVersion = useRef(0);
    const [state, dispatch] = useReducer(
        modelComparisonDataReducer,
        INITIAL_DATA_STATE,
    );
    const saveRegistry = useRegistryMutation(registry => {
        dispatch({ registry, type: 'registry-saved' });
        emitAppEvent('gnosi-ai-models-changed', { source: 'model-comparison' });
    });

    useEffect(() => () => { activationVersion.current += 1; }, [isOpen]);

    useEffect(() => {
        if (!isOpen) return undefined;
        const controller = new AbortController();
        void Promise.resolve().then(async () => {
            if (signalIsAborted(controller.signal)) return;
            dispatch({ type: 'feed-started' });
            try {
                const feed = await fetchAiModelComparison(controller.signal, state.requestVersion > 0);
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
                    fetchAiModelCatalog(state.requestVersion > 0, controller.signal),
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
        preferredProvider?: string,
    ): ModelSetupState => {
        const routes = routesForMode(model, mode);
        const creator = model.creator.toLocaleLowerCase();
        const route = routes.find((candidate) => candidate.provider === preferredProvider)
            ?? routes.find((candidate) => providersById[candidate.provider]?.has_api_key)
            ?? routes.find((candidate) => candidate.provider_connected)
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
            connectionStatus: 'untested',
            connectionError: '',
            mode,
            model,
            providerId: route?.provider ?? '',
            routeKey: route ? comparisonRouteKey(route) : '',
        };
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
    const beginActivation = (model: AiModelComparisonEntry, preferredProvider?: string): void => {
        activationVersion.current += 1;
        dispatch({ message: null, type: 'set-action-message' });
        const mode = preferredProvider && routesForMode(model, 'local').some((route) => route.provider === preferredProvider)
            ? 'local'
            : routesForMode(model, 'remote').length > 0
            ? 'remote'
            : routesForMode(model, 'local').length > 0
                ? 'local'
                : 'remote';
        dispatch({ setup: setupForMode(model, mode, preferredProvider), type: 'set-setup' });
    };
    const changeSetupMode = (mode: ComparisonSetupMode): void => {
        activationVersion.current += 1;
        if (!state.setup) return;
        dispatch({
            setup: setupForMode(state.setup.model, mode),
            type: 'set-setup',
        });
    };
    const changeSetupProvider = (routeKey: string): void => {
        activationVersion.current += 1;
        if (!state.setup) return;
        const route = routesForMode(state.setup.model, state.setup.mode)
            .find(candidate => comparisonRouteKey(candidate) === routeKey || candidate.provider === routeKey);
        if (!route) return;
        const providerId = route.provider;
        const provider = providersById[providerId];
        dispatch({
            patch: {
                apiKey: '',
                baseUrl: provider?.base_url ?? provider?.api ?? '',
                error: '',
                connectionStatus: 'untested',
                connectionError: '',
                providerId,
                routeKey: comparisonRouteKey(route),
            },
            type: 'patch-setup',
        });
    };
    const deactivateModel = async (
        model: AiModelComparisonEntry,
        provider = 'all',
        confirmation?: ModelDetachConfirmation,
    ): Promise<void> => {
        dispatch({ modelId: model.id, type: 'set-busy-model' });
        dispatch({ message: null, type: 'set-action-message' });
        try {
            await saveRegistry(latest => {
                const indexes = new Set(matchingRegistryIndexes(latest, model, provider));
                return latest.map((entry, index) => (
                    indexes.has(index) ? { ...entry, enabled: false } : entry
                ));
            }, undefined, confirmation?.revision);
            if (confirmation) onDetached?.(confirmation.routes);
            setDetachConfirmation(null);
            dispatch({
                message: {
                    key: 'model_disabled',
                    model: model.name,
                    type: 'success',
                },
                type: 'set-action-message',
            });
        } catch (error: unknown) {
            if (error instanceof GnosiApiError && error.status === 409 && error.payload && typeof error.payload === 'object' && 'detail' in error.payload) {
                const detail = error.payload.detail;
                if (detail && typeof detail === 'object' && 'code' in detail && detail.code === 'model_in_use' && 'confirmation_revision' in detail && typeof detail.confirmation_revision === 'string' && 'agents' in detail && Array.isArray(detail.agents) && 'routes' in detail && Array.isArray(detail.routes)) {
                    setDetachConfirmation({ model, provider, revision: detail.confirmation_revision,
                        agents: detail.agents.filter((value: unknown): value is { id: string; name: string } => Boolean(value && typeof value === 'object' && 'id' in value && typeof value.id === 'string' && 'name' in value && typeof value.name === 'string')),
                        routes: detail.routes.filter((value: unknown): value is { provider: string; model: string } => Boolean(value && typeof value === 'object' && 'provider' in value && typeof value.provider === 'string' && 'model' in value && typeof value.model === 'string')),
                    });
                    return;
                }
            }
            logError('ai-model-comparison-disable', error);
            dispatch({
                message: { key: 'configuration_save_error', type: 'error' },
                type: 'set-action-message',
            });
        } finally {
            dispatch({ modelId: '', type: 'set-busy-model' });
        }
    };
    const testSetupConnection = async (): Promise<void> => {
        const setup = state.setup;
        if (!setup) return;
        const version = ++activationVersion.current;
        const isCurrent = () => activationVersion.current === version;
        if (setup.mode === 'local') {
            await activateModel(setup, isCurrent);
            return;
        }
        const provider = providersById[setup.providerId];
        const selectedRoute = routesForMode(setup.model, setup.mode)
            .find((route) => setup.routeKey ? comparisonRouteKey(route) === setup.routeKey : route.provider === setup.providerId);
        const needsApiKey = !provider?.has_api_key;
        if (!provider || !selectedRoute || (needsApiKey && !setup.apiKey.trim())) return;
        dispatch({ patch: { connectionStatus: 'testing', connectionError: '', error: '' }, type: 'patch-setup' });
        try {
            if (setup.apiKey.trim()) {
                await setAiProviderCredentials(provider.id, {
                    api_key: setup.apiKey.trim(),
                    base_url: setup.baseUrl || provider.api || '',
                });
            }
            if (!isCurrent()) return;
            const result = await validateAiProvider(provider.id, { model: selectedRoute.model_id });
            if (!isCurrent()) return;
            const nextValidatedModels = new Set<string>(setup.apiKey.trim() ? [] : provider.validated_models ?? []);
            if (result.success) nextValidatedModels.add(selectedRoute.model_id);
            else nextValidatedModels.delete(selectedRoute.model_id);
            dispatch({
                providerId: provider.id,
                validatedModels: [...nextValidatedModels],
                savedKey: Boolean(setup.apiKey.trim()),
                type: 'provider-model-validation',
            });
            dispatch({
                patch: {
                    connectionStatus: result.success ? 'connected' : 'error',
                    connectionError: result.success ? '' : result.error || '',
                },
                type: 'patch-setup',
            });
            if (result.success && isCurrent()) {
                await activateModel({ ...setup, connectionStatus: 'connected' }, isCurrent);
            }
        } catch (error: unknown) {
            if (!isCurrent()) return;
            logError('ai-model-provider-validation', error);
            dispatch({
                patch: {
                    connectionStatus: 'error',
                    connectionError: error instanceof Error ? error.message : '',
                },
                type: 'patch-setup',
            });
        }
    };
    const activateModel = async (setup: ModelSetupState, isCurrent: () => boolean): Promise<void> => {
        if (!isCurrent()) return;
        const provider = providersById[setup.providerId];
        const selectedRoute = routesForMode(setup.model, setup.mode)
            .find((route) => setup.routeKey ? comparisonRouteKey(route) === setup.routeKey : route.provider === setup.providerId);
        const needsApiKey = setup.mode === 'remote' && !provider?.has_api_key;
        if (!provider || !selectedRoute || (needsApiKey && !setup.apiKey.trim())
            || (setup.mode === 'remote' && setup.connectionStatus !== 'connected')) {
            return;
        }
        dispatch({ modelId: setup.model.id, type: 'set-busy-model' });
        dispatch({ patch: { error: '' }, type: 'patch-setup' });
        try {
            const newEntry: AiModelRegistryEntry =
                comparisonRouteToRegistryEntry(selectedRoute);
            if (!provider.enabled || !provider.connected) {
                await setAiProviderStatus(provider.id, { enabled: true });
            }
            if (!isCurrent()) return;
            await saveRegistry(latest => {
                const existingIndex = latest.findIndex(entry => (
                    entry.provider === provider.id && entry.model_id === selectedRoute.model_id
                ));
                return existingIndex >= 0
                    ? latest.map((entry, index) => index === existingIndex
                        ? { ...entry, ...newEntry, enabled: true } : entry)
                    : [...latest, newEntry];
            }, isCurrent);
            if (!isCurrent()) return;
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
            if (!isCurrent()) return;
            logError('ai-model-comparison-enable', error);
            dispatch({
                patch: { error: error instanceof Error && error.message === 'unknown_route_price' ? 'unknown_route_price' : 'configuration_save_error', connectionStatus: 'error' },
                type: 'patch-setup',
            });
        } finally {
            dispatch({ modelId: '', type: 'set-busy-model' });
        }
    };

    return {
        detachConfirmation,
        cancelDeactivation: () => { setDetachConfirmation(null); },
        confirmDeactivation: async () => { if (detachConfirmation) await deactivateModel(detachConfirmation.model, detachConfirmation.provider, detachConfirmation); },
        beginActivation,
        changeSetupMode,
        changeSetupProvider,
        closeSetup: () => {
            activationVersion.current += 1;
            dispatch({ setup: null, type: 'set-setup' });
        },
        deactivateModel,
        testSetupConnection,
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
            activationVersion.current += 1;
            dispatch({ patch: { apiKey: value, error: '', connectionStatus: 'untested', connectionError: '' }, type: 'patch-setup' });
        },
        setSetupBaseUrl: (value) => {
            activationVersion.current += 1;
            dispatch({ patch: { baseUrl: value, error: '', connectionStatus: 'untested', connectionError: '' }, type: 'patch-setup' });
        },
        state,
    };
}
