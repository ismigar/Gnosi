import type { AiModelComparisonEntry } from '../../../shared/api/ai';

type Route = AiModelComparisonEntry['routes'][number];
export const knownContext = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;
export const selectedRoutes = (model: AiModelComparisonEntry, provider: string) => model.routes.filter(route => provider === 'all' || route.provider === provider);

export function routeModes(route: Route): readonly string[] | null {
    if (route.input_modes == null || route.output_modes == null) return null;
    return [...new Set([...route.input_modes, ...route.output_modes])].sort();
}

export function routeHasModes(route: Route, modes: readonly string[], match: 'all' | 'any'): boolean {
    if (!modes.length) return true;
    const available = routeModes(route);
    // A declared direction can establish support even when the other is unknown.
    const known = available ?? [...(route.input_modes ?? []), ...(route.output_modes ?? [])];
    return match === 'all' ? modes.every(mode => known.includes(mode)) : modes.some(mode => known.includes(mode));
}

export function routeContextValue(model: AiModelComparisonEntry, provider: string): number | null {
    const contexts = selectedRoutes(model, provider).map(route => route.context_window).filter(knownContext);
    return contexts.length ? Math.max(...contexts) : null;
}

export function comparisonRouteCapabilities(model: AiModelComparisonEntry, provider: string) {
    const seen = new Set<string>();
    return selectedRoutes(model, provider).filter(route => {
        const key = JSON.stringify([route.provider, route.context_window, route.input_modes, route.output_modes, route.tool_call, route.reasoning]);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    }).sort((a, b) => {
        if (!knownContext(a.context_window)) return knownContext(b.context_window) ? 1 : 0;
        if (!knownContext(b.context_window)) return -1;
        return b.context_window - a.context_window;
    });
}
