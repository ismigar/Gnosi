import { knownPrice } from './modelRouteCosts';

type ModelScalar = string | number | boolean | null | undefined;


export interface ComparisonRoute {
  readonly [key: string]: unknown;
  readonly context_window?: unknown;
  readonly cost_in?: unknown;
  readonly cost_out?: unknown;
  readonly is_local?: unknown;
  readonly model_id: string;
  readonly provider: string;
  readonly provider_name?: string | null;
  readonly quality?: unknown;
  readonly tags?: readonly string[] | null;
}


export interface ComparisonModel {
  readonly id?: ModelScalar;
  readonly name?: ModelScalar;
  readonly routes?: readonly ComparisonRoute[] | null;
  readonly slug?: ModelScalar;
}


export interface RegistryModelEntry {
  readonly model_id?: ModelScalar;
  readonly provider?: ModelScalar;
}


export interface ComparisonProvider {
  readonly configured?: unknown;
  readonly connected?: unknown;
  readonly validated_models?: readonly string[];
  readonly id: string;
  readonly live?: unknown;
  readonly name?: string | null;
}


export interface ResolvedComparisonRoute extends ComparisonRoute {
  readonly provider_connected: boolean;
  readonly provider_validated: boolean;
  readonly provider_name: string;
}

export const comparisonRouteKey = (route: ComparisonRoute): string =>
  JSON.stringify([route.provider, route.model_id]);


export interface ModelRegistryEntry {
  readonly [key: string]: unknown;
  readonly context_window: number;
  readonly cost_in: number;
  readonly cost_out: number;
  readonly enabled: true;
  readonly is_local: boolean;
  readonly model_id: string;
  readonly priority: 100;
  readonly provider: string;
  readonly quality: number;
  readonly tags: string[];
}


export function registryEntryMatchesModel(
  entry: RegistryModelEntry | null | undefined,
  comparisonModel: ComparisonModel | null | undefined,
): boolean {
  return (comparisonModel?.routes ?? []).some((route) => (
    route.provider === entry?.provider && route.model_id === entry.model_id
  ));
}


export function matchingRegistryIndexes(
  models: readonly RegistryModelEntry[] | null | undefined,
  comparisonModel: ComparisonModel | null | undefined,
  provider = 'all',
): number[] {
  return (models ?? []).reduce<number[]>((indexes, entry, index) => {
    if ((provider === 'all' || entry.provider === provider)
      && registryEntryMatchesModel(entry, comparisonModel)) indexes.push(index);
    return indexes;
  }, []);
}


export function comparisonRoutesForMode(
  comparisonModel: ComparisonModel | null | undefined,
  providers: readonly ComparisonProvider[] | null | undefined,
  mode: string,
): ResolvedComparisonRoute[] {
  const isLocal = mode === 'local';
  const providersById = new Map(
    (providers ?? []).map((provider) => [provider.id, provider] as const),
  );
  const routesByKey = new Map<string, ResolvedComparisonRoute>();

  for (const route of comparisonModel?.routes ?? []) {
    const provider = providersById.get(route.provider);
    if (!provider || Boolean(route.is_local) !== isLocal) continue;
    if (isLocal && !provider.live && !provider.configured) continue;
    const key = comparisonRouteKey(route);
    if (!routesByKey.has(key)) {
      routesByKey.set(key, {
        ...route,
        provider_name: provider.name || route.provider_name || provider.id,
        provider_connected: Boolean(provider.connected),
        provider_validated: (provider.validated_models ?? []).includes(route.model_id),
      });
    }
  }

  return [...routesByKey.values()].sort((first, second) => {
    if (first.provider_validated !== second.provider_validated) {
      return Number(second.provider_validated) - Number(first.provider_validated);
    }
    if (first.provider_connected !== second.provider_connected) {
      return Number(second.provider_connected) - Number(first.provider_connected);
    }
    return first.provider_name.localeCompare(second.provider_name);
  });
}


export function comparisonRouteToRegistryEntry(
  route: ComparisonRoute,
): ModelRegistryEntry {
  if (!knownPrice(route.cost_in) || !knownPrice(route.cost_out)) throw new Error('unknown_route_price');
  return {
    provider: route.provider,
    model_id: route.model_id,
    is_local: Boolean(route.is_local),
    enabled: true,
    priority: 100,
    cost_in: route.cost_in,
    cost_out: route.cost_out,
    context_window: Number(route.context_window) || 8192,
    quality: Number(route.quality) || 2,
    tags: [...(route.tags ?? [])],
  };
}
