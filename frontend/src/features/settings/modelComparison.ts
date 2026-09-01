import { matchingRegistryIndexes } from './model-comparison/modelComparisonRegistry';
import type {
    AiModelCatalog,
    AiModelCatalogProvider,
    AiModelComparison,
    AiModelComparisonEntry,
    AiModelRegistryEntry,
} from '../../shared/api/ai';


export const COMPARISON_PROFILE_KEYS = [
    'worker',
    'administrative',
    'documentalist',
    'allrounder',
    'expert',
    'unrated',
] as const;
export const COMPARISON_MODE_KEYS = ['text', 'image', 'audio', 'video'] as const;


export type ComparisonProfile = typeof COMPARISON_PROFILE_KEYS[number];
export type ComparisonMode = typeof COMPARISON_MODE_KEYS[number];
export type ComparisonSetupMode = 'local' | 'remote';
export type ComparisonAvailability = 'active' | 'all' | 'inactive';
export type ComparisonSortDirection = 'asc' | 'desc';
export type ComparisonSortKey =
    | 'agentic'
    | 'coding'
    | 'context_window'
    | 'creator'
    | 'input_price'
    | 'intelligence'
    | 'latency'
    | 'modes'
    | 'name'
    | 'output_price'
    | 'profile'
    | 'speed';


export interface ComparisonSort {
    readonly direction: ComparisonSortDirection;
    readonly key: ComparisonSortKey;
}


export interface ModelComparisonUiState {
    readonly availability: ComparisonAvailability;
    readonly inputTokens: string;
    readonly maxPrice: string;
    readonly minContext: string;
    readonly modes: readonly ComparisonMode[];
    readonly modesMenuOpen: boolean;
    readonly outputTokens: string;
    readonly profile: 'all' | ComparisonProfile;
    readonly query: string;
    readonly showIncomplete: boolean;
    readonly showProfileHelp: boolean;
    readonly sort: ComparisonSort;
}


export type ModelComparisonUiAction =
    | { readonly type: 'change-sort'; readonly key: ComparisonSortKey }
    | { readonly type: 'set-availability'; readonly value: ComparisonAvailability }
    | { readonly type: 'set-input-tokens'; readonly value: string }
    | { readonly type: 'set-max-price'; readonly value: string }
    | { readonly type: 'set-min-context'; readonly value: string }
    | { readonly type: 'set-output-tokens'; readonly value: string }
    | { readonly type: 'set-profile'; readonly value: 'all' | ComparisonProfile }
    | { readonly type: 'set-query'; readonly value: string }
    | { readonly type: 'set-show-incomplete'; readonly value: boolean }
    | { readonly type: 'set-show-profile-help'; readonly value: boolean }
    | { readonly type: 'toggle-mode'; readonly mode: ComparisonMode }
    | { readonly type: 'toggle-modes-menu' };


export interface ModelSetupState {
    readonly apiKey: string;
    readonly baseUrl: string;
    readonly error: string;
    readonly mode: ComparisonSetupMode;
    readonly model: AiModelComparisonEntry;
    readonly providerId: string;
}


export interface ModelActionMessage {
    readonly key: string;
    readonly model?: string;
    readonly provider?: string;
    readonly type: 'error' | 'success';
}


export interface ModelRegistryState {
    readonly budget: AiModelComparisonRegistryBudget;
    readonly models: readonly AiModelRegistryEntry[];
}


export type AiModelComparisonRegistryBudget = Readonly<Record<string, unknown>>;


export interface MetricAvailability {
    readonly agentic: boolean;
    readonly coding: boolean;
    readonly intelligence: boolean;
    readonly latency: boolean;
    readonly profile: boolean;
    readonly speed: boolean;
}


export interface ComparisonColumn {
    readonly key: ComparisonSortKey;
    readonly label: string;
}


export const INITIAL_COMPARISON_UI_STATE: ModelComparisonUiState = {
    availability: 'all',
    inputTokens: '5000000',
    maxPrice: '',
    minContext: '',
    modes: [],
    modesMenuOpen: false,
    outputTokens: '1000000',
    profile: 'all',
    query: '',
    showIncomplete: false,
    showProfileHelp: false,
    sort: { direction: 'desc', key: 'intelligence' },
};


export const PROFILE_ICONS: Readonly<Partial<Record<ComparisonProfile, string>>> = {
    administrative: '🔵',
    allrounder: '🟡',
    documentalist: '📑',
    expert: '🟣',
    unrated: '⚪',
    worker: '🟢',
};


export function modelComparisonUiReducer(
    state: ModelComparisonUiState,
    action: ModelComparisonUiAction,
): ModelComparisonUiState {
    switch (action.type) {
        case 'change-sort':
            return {
                ...state,
                sort: {
                    direction: state.sort.key === action.key
                        && state.sort.direction === 'asc'
                        ? 'desc'
                        : 'asc',
                    key: action.key,
                },
            };
        case 'set-availability':
            return { ...state, availability: action.value };
        case 'set-input-tokens':
            return { ...state, inputTokens: action.value };
        case 'set-max-price':
            return { ...state, maxPrice: action.value };
        case 'set-min-context':
            return { ...state, minContext: action.value };
        case 'set-output-tokens':
            return { ...state, outputTokens: action.value };
        case 'set-profile':
            return { ...state, profile: action.value };
        case 'set-query':
            return { ...state, query: action.value };
        case 'set-show-incomplete':
            return { ...state, showIncomplete: action.value };
        case 'set-show-profile-help':
            return { ...state, showProfileHelp: action.value };
        case 'toggle-mode':
            return {
                ...state,
                modes: state.modes.includes(action.mode)
                    ? state.modes.filter((mode) => mode !== action.mode)
                    : [...state.modes, action.mode],
            };
        case 'toggle-modes-menu':
            return { ...state, modesMenuOpen: !state.modesMenuOpen };
    }
}


export const parseNonNegativeNumber = (value: string | number): number => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};


export const isFiniteMetric = (value: unknown): value is number => (
    value !== null
    && value !== undefined
    && Number.isFinite(Number(value))
    && Number(value) >= 0
);


export const formatComparisonMetric = (
    value: unknown,
    digits = 1,
): string => (
    isFiniteMetric(value)
        ? value.toLocaleString(undefined, {
            maximumFractionDigits: digits,
        })
        : '—'
);


export const formatComparisonContext = (value: unknown): string => {
    if (!isFiniteMetric(value)) return '—';
    if (value >= 1_000_000) {
        return `${formatComparisonMetric(value / 1_000_000, 1)}M`;
    }
    return `${formatComparisonMetric(value / 1000, 0)}K`;
};


export const formatComparisonCost = (
    value: unknown,
    symbol: string,
    digits = 2,
): string => {
    if (!isFiniteMetric(value)) return '—';
    const formatted = value.toLocaleString(undefined, {
        maximumFractionDigits: digits,
        minimumFractionDigits: digits,
    });
    return symbol === '€' ? `${formatted} ${symbol}` : `${symbol}${formatted}`;
};


export const modelMonthlyCost = (
    model: AiModelComparisonEntry,
    inputTokens: string,
    outputTokens: string,
): number | null => {
    if (!isFiniteMetric(model.input_price)
        || !isFiniteMetric(model.output_price)) return null;
    return (
        (parseNonNegativeNumber(inputTokens) / 1_000_000) * model.input_price
        + (parseNonNegativeNumber(outputTokens) / 1_000_000) * model.output_price
    );
};


export const modelMetricAvailability = (
    feed: AiModelComparison | null,
): MetricAvailability => {
    const models = feed?.models ?? [];
    return {
        agentic: models.some((model) => model.agentic !== null),
        coding: models.some((model) => model.coding !== null),
        intelligence: models.some((model) => model.intelligence !== null),
        latency: models.some((model) => model.latency !== null),
        profile: models.some((model) => (
            Boolean(model.profile) && model.profile !== 'unrated'
        )),
        speed: models.some((model) => model.speed !== null),
    };
};


export const modelComparisonColumns = (
    available: MetricAvailability,
): readonly ComparisonColumn[] => [
    { key: 'name', label: 'model' },
    { key: 'creator', label: 'creator' },
    { key: 'modes', label: 'modes' },
    ...(available.intelligence
        ? [{ key: 'intelligence', label: 'intelligence' } as const]
        : []),
    ...(available.coding
        ? [{ key: 'coding', label: 'coding' } as const]
        : []),
    ...(available.agentic
        ? [{ key: 'agentic', label: 'agentic' } as const]
        : []),
    { key: 'input_price', label: 'input_price' },
    { key: 'output_price', label: 'output_price' },
    { key: 'context_window', label: 'context' },
    ...(available.speed ? [{ key: 'speed', label: 'speed' } as const] : []),
    ...(available.latency ? [{ key: 'latency', label: 'latency' } as const] : []),
    ...(available.profile ? [{ key: 'profile', label: 'profile' } as const] : []),
];


const sortableModelValue = (
    model: AiModelComparisonEntry,
    key: ComparisonSortKey,
): number | string | null => {
    const value = model[key];
    if (Array.isArray(value)) return value.join(',');
    return typeof value === 'number' || typeof value === 'string' ? value : null;
};


export const filteredComparisonModels = (
    feed: AiModelComparison | null,
    registryModels: readonly AiModelRegistryEntry[],
    ui: ModelComparisonUiState,
): readonly AiModelComparisonEntry[] => {
    const normalizedQuery = ui.query.trim().toLocaleLowerCase();
    const priceLimit = ui.maxPrice === ''
        ? Number.POSITIVE_INFINITY
        : parseNonNegativeNumber(ui.maxPrice);
    const contextFloor = ui.minContext === ''
        ? 0
        : parseNonNegativeNumber(ui.minContext) * 1000;
    const deduped = new Map<string, AiModelComparisonEntry>();
    for (const model of feed?.models ?? []) {
        const key = model.id || model.slug || model.name;
        if (!deduped.has(key)) deduped.set(key, model);
    }

    return [...deduped.values()].filter((model) => (
        (!normalizedQuery
            || `${model.name} ${model.creator}`
                .toLocaleLowerCase()
                .includes(normalizedQuery))
        && (ui.profile === 'all' || model.profile === ui.profile)
        && (
            ui.showIncomplete
            || (
                model.profile !== 'unrated'
                && model.coding !== null
                && model.agentic !== null
                && model.input_price !== null
                && model.context_window !== null
            )
            || ui.profile === 'unrated'
            || normalizedQuery !== ''
            || ui.maxPrice !== ''
            || ui.minContext !== ''
        )
        && (
            ui.modes.length === 0
            || ui.modes.some((mode) => model.modes.includes(mode))
        )
        && (
            ui.availability === 'all'
            || matchingRegistryIndexes(registryModels, model)
                .some((index) => registryModels[index]?.enabled !== false)
                === (ui.availability === 'active')
        )
        && (
            ui.maxPrice === ''
            || (model.input_price !== null && model.input_price <= priceLimit)
        )
        && (
            ui.minContext === ''
            || (model.context_window !== null
                && model.context_window >= contextFloor)
        )
    )).sort((left, right) => {
        const first = sortableModelValue(left, ui.sort.key);
        const second = sortableModelValue(right, ui.sort.key);
        if (first === null && second === null) return 0;
        if (first === null) return 1;
        if (second === null) return -1;
        const comparison = typeof first === 'string'
            ? first.localeCompare(String(second))
            : first - Number(second);
        return ui.sort.direction === 'asc' ? comparison : -comparison;
    });
};


export const comparisonProvidersById = (
    catalog: AiModelCatalog | null,
): Readonly<Record<string, AiModelCatalogProvider>> => Object.fromEntries(
    (catalog?.providers ?? []).map((provider) => [provider.id, provider]),
);


const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => (
    typeof value === 'object' && value !== null && !Array.isArray(value)
);


export const isAbortError = (error: unknown): boolean => (
    isRecord(error) && error.name === 'AbortError'
);


export const modelComparisonErrorCode = (error: unknown): string => {
    if (!isRecord(error)) return 'network_error';
    const payload = error.payload;
    if (isRecord(payload)) {
        const detail = payload.detail;
        if (isRecord(detail) && typeof detail.code === 'string') return detail.code;
    }
    return typeof error.code === 'string' ? error.code : 'network_error';
};
