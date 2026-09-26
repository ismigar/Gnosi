import type { AiModelCatalog, AiModelComparison } from '../../../shared/api/ai';
import type { ModelActionMessage, ModelRegistryState, ModelSetupState } from '../modelComparison';

export interface ModelComparisonDataState {
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
    | { readonly type: 'provider-model-validation'; readonly providerId: string; readonly validatedModels: readonly string[]; readonly savedKey: boolean }
    | { readonly type: 'configuration-failed' }
    | { readonly type: 'configuration-loaded'; readonly catalog: AiModelCatalog; readonly registry: ModelRegistryState }
    | { readonly type: 'configuration-started' }
    | { readonly type: 'dismiss-fallback' }
    | { readonly type: 'feed-failed'; readonly errorCode: string }
    | { readonly type: 'feed-loaded'; readonly feed: AiModelComparison }
    | { readonly type: 'feed-started' }
    | { readonly type: 'patch-setup'; readonly patch: Partial<ModelSetupState> }
    | { readonly type: 'registry-saved'; readonly registry: ModelRegistryState }
    | { readonly type: 'retry' }
    | { readonly type: 'set-action-message'; readonly message: ModelActionMessage | null }
    | { readonly type: 'set-api-key-input'; readonly value: string }
    | { readonly type: 'set-busy-model'; readonly modelId: string }
    | { readonly type: 'set-saving-api-key'; readonly value: boolean }
    | { readonly type: 'set-setup'; readonly setup: ModelSetupState | null };


export const INITIAL_DATA_STATE: ModelComparisonDataState = {
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


export function modelComparisonDataReducer(
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
        case 'provider-model-validation':
            if (!state.catalog) return state;
            return {
                ...state,
                catalog: {
                    ...state.catalog,
                    providers: state.catalog.providers.map((provider) => (
                        provider.id === action.providerId
                            ? {
                                ...provider,
                                validated_models: [...action.validatedModels],
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
                registry: action.registry,
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
