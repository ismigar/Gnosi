import type { AiModelComparisonEntry } from '../../../shared/api/ai';

type Route = AiModelComparisonEntry['routes'][number];
export const knownPrice = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

/** Provider prices are never substituted with the benchmark vendor's prices. */
export function comparisonRouteCosts(model: AiModelComparisonEntry, provider: string, inputTokens: string, outputTokens: string) {
    const input = Number(inputTokens.replaceAll('.', '')) || 0;
    const output = Number(outputTokens.replaceAll('.', '')) || 0;
    const seen = new Set<string>();
    return model.routes.filter(route => provider === 'all' || route.provider === provider).flatMap(route => {
        const key = JSON.stringify([route.provider, route.cost_in, route.cost_out, route.is_local]);
        if (seen.has(key)) return [];
        seen.add(key);
        const cost = knownPrice(route.cost_in) && knownPrice(route.cost_out)
            ? (input * route.cost_in + output * route.cost_out) / 1_000_000 : null;
        return [{ route, cost }];
    }).sort((a, b) => a.cost === null ? (b.cost === null ? 0 : 1) : b.cost === null ? -1 : a.cost - b.cost);
}

export function routePriceValue(model: AiModelComparisonEntry, provider: string, field: 'input_price' | 'output_price' | 'monthly_cost', input: string, output: string): number | null {
    const costs = comparisonRouteCosts(model, provider, input, output);
    const values = costs.map(({ route, cost }) => field === 'monthly_cost' ? cost : route[field === 'input_price' ? 'cost_in' : 'cost_out']);
    const known = values.filter(knownPrice);
    return known.length ? Math.min(...known) : null;
}

export function routeHasPrice(route: Route, limit: number): boolean {
    return knownPrice(route.cost_in) && route.cost_in <= limit;
}
