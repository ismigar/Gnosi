import { isRecord, type LooseRecord, type LooseValue } from './agentChatMessageTypes';

export interface TeamPhaseUsage extends LooseRecord {
    phase: string;
    model_calls: number;
    input_tokens: number;
    output_tokens: number;
    cost_usd?: number;
}
export interface TeamUsageMetrics extends LooseRecord {
    team_phases?: TeamPhaseUsage[];
    team_route?: string;
    team_usage_complete?: boolean;
    team_cost_source?: string;
}
const phases = ['planning', 'execution', 'synthesis', 'repair'] as const;
const count = (value: LooseValue) => typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.min(Number.MAX_SAFE_INTEGER, Math.floor(value)) : 0;

export function boundedTeamUsage(value: LooseRecord): TeamUsageMetrics {
    const usage = isRecord(value.team_usage) ? value.team_usage : null;
    const source = usage && isRecord(usage.phases) ? usage.phases : null;
    const restored = Array.isArray(value.team_phases) ? value.team_phases : [];
    const rows = phases.flatMap((phase) => {
        const row = source?.[phase] ?? restored.find((item) => isRecord(item) && item.phase === phase);
        if (!isRecord(row)) return [];
        const cost = row.estimated_cost_usd ?? row.cost_usd;
        return [{ phase, model_calls: count(row.model_calls), input_tokens: count(row.input_tokens), output_tokens: count(row.output_tokens),
            ...(typeof cost === 'number' && Number.isFinite(cost) && cost >= 0 ? { cost_usd: Math.min(1_000_000, cost) } : {}) }];
    });
    if (!usage && !rows.length) return {};
    const route = usage && isRecord(usage.routing) ? usage.routing.mode : value.team_route;
    const costSource = usage?.cost_source ?? value.team_cost_source;
    return { team_phases: rows,
        team_usage_complete: (usage?.usage_complete ?? value.team_usage_complete) === true,
        ...(typeof route === 'string' && ['director', 'direct', 'continuation'].includes(route) ? { team_route: route } : {}),
        ...(typeof costSource === 'string' && ['reported', 'estimated', 'unknown'].includes(costSource) ? { team_cost_source: costSource } : {}),
    };
}
