import { knownContext, selectedRoutes, routeHasModes, routeContextValue, routeModes } from './model-comparison/modelRouteCapabilities';
import { routePriceValue, routeHasPrice } from './model-comparison/modelRouteCosts';
import { modelParameterDisclosure, modelParameterMetadata } from './model-comparison/modelParameters';
import { matchingRegistryIndexes } from './model-comparison/modelComparisonRegistry';
import type {
    AiModelCatalog,
    AiModelCatalogProvider,
    AiModelComparison,
    AiModelComparisonEntry,
    AiModelRegistryEntry,
} from '../../shared/api/ai';


export const COMPARISON_PROFILE_KEYS = [
    'director',
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
    | 'monthly_cost'
    | 'parameters'
    | 'modes'
    | 'name'
    | 'output_price'
    | 'profile'
    | 'provider'
    | 'speed';


export interface ComparisonSort {
    readonly direction: ComparisonSortDirection;
    readonly key: ComparisonSortKey;
}


export type ParameterStatusFilter = 'all' | 'known' | 'not_published' | 'pending';

export interface ModelComparisonUiState {
    readonly availability: ComparisonAvailability;
    readonly inputTokens: string;
    readonly maxPrice: string;
    readonly minContext: string;
    readonly modes: readonly ComparisonMode[];
    readonly modesMenuOpen: boolean;
    readonly modeMatch: 'all' | 'any';
    readonly parameterStatus: ParameterStatusFilter;
    readonly minParameters: string;
    readonly maxParameters: string;
    readonly outputTokens: string;
    readonly provider: string;
    readonly profile: 'all' | ComparisonProfile;
    readonly query: string;
    readonly showIncomplete: boolean;
    readonly showProfileHelp: boolean;
    readonly sort: ComparisonSort;
}


export type ModelComparisonUiAction =
    | { readonly type: 'compare-role-candidates' }
    | { readonly type: 'change-sort'; readonly key: ComparisonSortKey }
    | { readonly type: 'set-availability'; readonly value: ComparisonAvailability }
    | { readonly type: 'set-input-tokens'; readonly value: string }
    | { readonly type: 'set-max-price'; readonly value: string }
    | { readonly type: 'set-min-context'; readonly value: string }
    | { readonly type: 'set-output-tokens'; readonly value: string }
    | { readonly type: 'set-profile'; readonly value: 'all' | ComparisonProfile }
    | { readonly type: 'set-provider'; readonly value: string }
    | { readonly type: 'set-query'; readonly value: string }
    | { readonly type: 'set-show-incomplete'; readonly value: boolean }
    | { readonly type: 'set-show-profile-help'; readonly value: boolean }
    | { readonly type: 'toggle-mode'; readonly mode: ComparisonMode }
    | { readonly type: 'set-mode-match'; readonly value: 'all' | 'any' }
    | { readonly type: 'set-parameter-status'; readonly value: ParameterStatusFilter }
    | { readonly type: 'set-min-parameters'; readonly value: string }
    | { readonly type: 'set-max-parameters'; readonly value: string }
    | { readonly type: 'close-modes-menu' }
    | { readonly type: 'toggle-modes-menu' };


export interface ModelSetupState {
    readonly alias?: string;
    readonly apiKey: string;
    readonly baseUrl: string;
    readonly error: string;
    readonly connectionStatus: 'untested' | 'testing' | 'connected' | 'error';
    readonly connectionError: string;
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
    modeMatch: 'all',
    parameterStatus: 'all',
    minParameters: '',
    maxParameters: '',
    outputTokens: '1000000',
    provider: 'all',
    profile: 'all',
    query: '',
    showIncomplete: false,
    showProfileHelp: false,
    sort: { direction: 'desc', key: 'intelligence' },
};


export const PROFILE_ICONS: Readonly<Partial<Record<ComparisonProfile, string>>> = {
    director: '🧭',
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
            return { ...state, inputTokens: normalizeTokenCountInput(action.value) ?? state.inputTokens };
        case 'set-max-price':
            return { ...state, maxPrice: action.value };
        case 'set-min-context':
            return { ...state, minContext: action.value };
        case 'set-output-tokens':
            return { ...state, outputTokens: normalizeTokenCountInput(action.value) ?? state.outputTokens };
        case 'set-provider':
            return { ...state, provider: action.value };
        case 'set-profile':
            return { ...state, profile: action.value, sort: action.value === 'all' || action.value === 'unrated' ? state.sort : { key: 'profile', direction: 'desc' } };
        case 'compare-role-candidates':
            return { ...INITIAL_COMPARISON_UI_STATE, profile: state.profile, inputTokens: state.inputTokens, outputTokens: state.outputTokens, showIncomplete: true, sort: { key: 'profile', direction: 'desc' } };
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
        case 'set-mode-match':
            return { ...state, modeMatch: action.value };
        case 'set-parameter-status':
            return { ...state, parameterStatus: action.value };
        case 'set-min-parameters':
            return { ...state, minParameters: action.value };
        case 'set-max-parameters':
            return { ...state, maxParameters: action.value };
        case 'close-modes-menu':
            return { ...state, modesMenuOpen: false };
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
    if (value > 0 && value < 10 ** -digits) return `< ${formatComparisonCost(10 ** -digits, symbol, digits)}`;
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
            Boolean(model.role_assessments?.length) || (Boolean(model.profile) && model.profile !== 'unrated')
        )),
        speed: models.some((model) => model.speed !== null),
    };
};


export const modelComparisonColumns = (
    available: MetricAvailability,
): readonly ComparisonColumn[] => [
    { key: 'name', label: 'model' },
    ...(available.profile ? [{ key: 'profile', label: 'profile' } as const] : []),
    { key: 'monthly_cost', label: 'monthly_cost' },
    { key: 'creator', label: 'creator' },
    ...(available.intelligence
        ? [{ key: 'intelligence', label: 'intelligence' } as const] : []),
    { key: 'context_window', label: 'context' },
    { key: 'input_price', label: 'input_price' },
    { key: 'output_price', label: 'output_price' },
    { key: 'modes', label: 'modes' },
    { key: 'parameters', label: 'parameters' },
    ...(available.speed ? [{ key: 'speed', label: 'speed' } as const] : []),
    ...(available.latency ? [{ key: 'latency', label: 'latency' } as const] : []),
    ...(available.coding ? [{ key: 'coding', label: 'coding' } as const] : []),
    ...(available.agentic ? [{ key: 'agentic', label: 'agentic' } as const] : []),
];


const sortableModelValue = (
    model: AiModelComparisonEntry,
    key: ComparisonSortKey,
    profile: ModelComparisonUiState['profile'],
    provider: string,
): number | string | null => {
    if (key === 'context_window') return routeContextValue(model, provider);
    if (key === 'modes') {
        const modes = selectedRoutes(model, provider).map(routeModes).filter(value => value !== null).flat();
        return modes.length ? [...new Set(modes)].sort().join(',') : null;
    }
    if (key === 'parameters') return modelParameterMetadata(model)?.total ?? null;
    if (key === 'provider') return [...new Set(model.routes.map(route => route.provider))].sort().join(', ');
    if (key === 'profile') {
        const scores = (model.role_assessments ?? []).filter(r => (profile === 'all' ? ['catalog_compatible', 'tested'].includes(r.status) : r.role === profile)).map(r => r.score).filter((score): score is number => typeof score === 'number' && Number.isFinite(score));
        return scores.length ? Math.max(...scores) : null;
    }
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

    const hasRouteFilters = ui.maxPrice !== '' || ui.minContext !== '' || ui.modes.length > 0;
    const matchesRoute = (route: AiModelComparisonEntry['routes'][number]) =>
        (ui.maxPrice === '' || routeHasPrice(route, priceLimit / (feed?.currency.usd_rate || 1)))
        && (ui.minContext === '' || (knownContext(route.context_window) && route.context_window >= contextFloor))
        && routeHasModes(route, ui.modes, ui.modeMatch);
    // Display and sort the same offers that satisfied the filters.
    const candidates = [...deduped.values()].map(model => hasRouteFilters
        ? { ...model, routes: selectedRoutes(model, ui.provider).filter(matchesRoute) }
        : model);
    return candidates.filter((model) => (
        (!normalizedQuery
            || `${model.name} ${model.creator} ${matchingRegistryIndexes(registryModels, model).map(index => registryModels[index]?.alias || '').join(' ')}`
                .toLocaleLowerCase()
                .includes(normalizedQuery))
        && (ui.provider === 'all' || model.routes.some((route) => route.provider === ui.provider))
        && (ui.profile === 'all' || (model.role_assessments?.length
            ? (ui.profile === 'unrated' ? model.role_assessments.every(r => !['catalog_compatible', 'tested'].includes(r.status)) : model.role_assessments.some(r => r.role === ui.profile && (['catalog_compatible', 'tested'].includes(r.status) || (ui.showIncomplete && r.status === 'insufficient_data'))))
            : model.profile === ui.profile))
        && (
            ui.showIncomplete
            || (ui.profile !== 'all' && ui.profile !== 'unrated')
            || (
                (model.role_assessments?.length ? model.role_assessments.some(r => ['catalog_compatible', 'tested'].includes(r.status)) : model.profile !== 'unrated')
                && model.coding !== null
                && model.agentic !== null
                && selectedRoutes(model, ui.provider).some(route => routeHasPrice(route, Infinity) && knownContext(route.context_window))
            )
            || ui.profile === 'unrated'
            || normalizedQuery !== ''
            || ui.maxPrice !== ''
            || ui.minContext !== ''
            || ui.parameterStatus !== 'all'
            || ui.minParameters !== ''
            || ui.maxParameters !== ''
        )
        && (
            ui.availability === 'all'
            || matchingRegistryIndexes(registryModels, model)
                .some((index) => registryModels[index]?.enabled !== false)
                === (ui.availability === 'active')
        )
        && (!hasRouteFilters || model.routes.length > 0)
        && matchesParameterFilters(model, ui)
    )).sort((left, right) => {
        const first = ['monthly_cost', 'input_price', 'output_price'].includes(ui.sort.key)
            ? routePriceValue(left, ui.provider, ui.sort.key as 'monthly_cost' | 'input_price' | 'output_price', ui.inputTokens, ui.outputTokens)
            : sortableModelValue(left, ui.sort.key, ui.profile, ui.provider);
        const second = ['monthly_cost', 'input_price', 'output_price'].includes(ui.sort.key)
            ? routePriceValue(right, ui.provider, ui.sort.key as 'monthly_cost' | 'input_price' | 'output_price', ui.inputTokens, ui.outputTokens)
            : sortableModelValue(right, ui.sort.key, ui.profile, ui.provider);
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


function matchesParameterFilters(model: AiModelComparisonEntry, ui: ModelComparisonUiState): boolean {
    const parameters = modelParameterMetadata(model);
    const status = parameters ? 'known' : modelParameterDisclosure(model).status;
    if (ui.parameterStatus !== 'all' && ui.parameterStatus !== status) return false;
    if (ui.minParameters === '' && ui.maxParameters === '') return true;
    if (!parameters) return false;
    return (ui.minParameters === '' || parameters.total >= parseNonNegativeNumber(ui.minParameters))
        && (ui.maxParameters === '' || parameters.total <= parseNonNegativeNumber(ui.maxParameters));
}


/** Token counts are integers; dots and spaces are display grouping only. */
export const normalizeTokenCountInput = (value: string): string | null => {
    const digits = value.replace(/[.\s]/g, '');
    return /^\d*$/.test(digits) ? digits.replace(/^0+(?=\d)/, '') : null;
};

export const formatTokenCountInput = (value: string): string => (
    value.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
);
