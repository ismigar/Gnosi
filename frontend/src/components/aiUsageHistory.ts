import type { AiUsageHistory } from '../shared/api/ai';


export type UsageGroup = 'model' | 'profile' | 'provider';
export type UsageTimeframe = 'all' | 'month' | 'quarter' | 'semester' | 'year';
export type UsageIcon = 'model' | 'profile' | 'provider';


export interface ActiveUsageModel {
    model_id?: string;
    name?: string;
    profile?: string;
    provider?: string;
}


interface ModelProfile {
    name: string;
    profile: string;
    provider: string;
}


export interface ProcessedUsageItem {
    badge: string | null;
    costCcy: number;
    costUsd: number;
    icon: UsageIcon;
    in: number;
    key: string;
    label: string;
    out: number;
    percent: number;
    subLabel: string;
}


export interface ProcessedUsage {
    curSymbol: string;
    items: ProcessedUsageItem[];
    totalCostCcy: number;
    totalTokensIn: number;
    totalTokensOut: number;
}


interface ProcessUsageOptions {
    groupBy: UsageGroup;
    history: AiUsageHistory | null;
    modelProfiles: ReadonlyMap<string, ModelProfile>;
    now?: Date;
    profileLabel: (profile: string) => string;
    providerLabel: string;
    timeframe: UsageTimeframe;
}


type UsageAccumulator = Omit<ProcessedUsageItem, 'costCcy' | 'percent'>;


export const formatUsageCost = (
    value: number,
    symbol: string,
    digits = 2,
): string => {
    const formatted = value.toLocaleString(undefined, {
        maximumFractionDigits: digits,
        minimumFractionDigits: digits,
    });
    return symbol === '€' ? `${formatted} ${symbol}` : `${symbol}${formatted}`;
};


export const formatUsageTokens = (value: number): string => {
    if (value <= 0) return '0';
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
    if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
    return value.toLocaleString();
};


export const buildModelProfileMap = (
    activeModels: readonly ActiveUsageModel[],
): ReadonlyMap<string, ModelProfile> => {
    const profiles = new Map<string, ModelProfile>();
    for (const model of activeModels) {
        if (!model.model_id) continue;
        profiles.set(model.model_id, {
            name: model.name || model.model_id,
            profile: model.profile || 'unrated',
            provider: model.provider || '',
        });
    }
    return profiles;
};


const selectedPeriods = (
    allPeriods: readonly string[],
    timeframe: UsageTimeframe,
    now: Date,
): readonly string[] => {
    if (timeframe === 'month') {
        const month = (now.getMonth() + 1).toString().padStart(2, '0');
        const currentPeriod = `${now.getFullYear().toString()}-${month}`;
        return allPeriods.filter((period) => period === currentPeriod);
    }
    if (timeframe === 'quarter') return allPeriods.slice(0, 3);
    if (timeframe === 'semester') return allPeriods.slice(0, 6);
    if (timeframe === 'year') {
        const year = now.getFullYear().toString();
        return allPeriods.filter((period) => period.startsWith(year));
    }
    return allPeriods;
};


export const processAiUsageHistory = ({
    groupBy,
    history,
    modelProfiles,
    now = new Date(),
    profileLabel,
    providerLabel,
    timeframe,
}: ProcessUsageOptions): ProcessedUsage => {
    if (!history) {
        return {
            curSymbol: '€',
            items: [],
            totalCostCcy: 0,
            totalTokensIn: 0,
            totalTokensOut: 0,
        };
    }

    const curSymbol = history.currency.symbol || '€';
    const curRate = history.currency.usd_rate || 1;
    const allPeriods = Object.keys(history.periods).sort().reverse();
    const periodKeys = selectedPeriods(allPeriods, timeframe, now);
    const groups = new Map<string, UsageAccumulator>();
    let totalTokensIn = 0;
    let totalTokensOut = 0;
    let totalCostUsd = 0;

    for (const periodKey of periodKeys) {
        const period = history.periods[periodKey];
        if (!period) continue;
        for (const row of period.models) {
            const provider = row.provider || 'generic';
            const meta = modelProfiles.get(row.model_id) ?? {
                name: row.model_id,
                profile: 'unrated',
                provider,
            };
            totalTokensIn += row.in;
            totalTokensOut += row.out;
            totalCostUsd += row.cost_usd;

            let key = row.model_id;
            let label = meta.name || row.model_id;
            let subLabel = provider;
            let icon: UsageIcon = 'model';
            let badge: string | null = meta.profile;
            if (groupBy === 'profile') {
                key = meta.profile || 'unrated';
                label = profileLabel(key);
                subLabel = '';
                icon = 'profile';
                badge = key;
            } else if (groupBy === 'provider') {
                key = provider || 'generic';
                label = key.toUpperCase();
                subLabel = providerLabel;
                icon = 'provider';
                badge = null;
            }

            const group = groups.get(key) ?? {
                badge,
                costUsd: 0,
                icon,
                in: 0,
                key,
                label,
                out: 0,
                subLabel,
            };
            group.in += row.in;
            group.out += row.out;
            group.costUsd += row.cost_usd;
            groups.set(key, group);
        }
    }

    const items = [...groups.values()].map((group) => ({
        ...group,
        costCcy: group.costUsd * curRate,
        percent: totalCostUsd > 0 ? (group.costUsd / totalCostUsd) * 100 : 0,
    })).sort((left, right) => right.costUsd - left.costUsd);
    return {
        curSymbol,
        items,
        totalCostCcy: totalCostUsd * curRate,
        totalTokensIn,
        totalTokensOut,
    };
};
