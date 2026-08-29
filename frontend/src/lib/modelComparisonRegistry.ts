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
  readonly tags?: readonly unknown[] | null;
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
  readonly id: string;
  readonly live?: unknown;
  readonly name?: string | null;
}


export interface ResolvedComparisonRoute extends ComparisonRoute {
  readonly provider_connected: boolean;
  readonly provider_name: string;
}


export interface ModelRegistryEntry {
  readonly context_window: number;
  readonly cost_in: number;
  readonly cost_out: number;
  readonly enabled: true;
  readonly is_local: boolean;
  readonly model_id: string;
  readonly priority: 100;
  readonly provider: string;
  readonly quality: number;
  readonly tags: unknown[];
}


const normalize = (value: ModelScalar): string => (
  String(value || '').toLocaleLowerCase().replace(/[^a-z0-9]+/g, '')
);


const isProviderQualifiedModelId = (value: ModelScalar): boolean => (
  String(value || '').includes('/')
);


export function registryEntryMatchesModel(
  entry: RegistryModelEntry | null | undefined,
  comparisonModel: ComparisonModel | null | undefined,
): boolean {
  const exactRoute = (comparisonModel?.routes ?? []).some((route) => (
    route.provider === entry?.provider && route.model_id === entry.model_id
  ));
  if (exactRoute) return true;

  const registryModel = normalize(entry?.model_id);
  if (!registryModel) return false;
  return [comparisonModel?.slug, comparisonModel?.name, comparisonModel?.id]
    .filter((candidate) => (
      !isProviderQualifiedModelId(entry?.model_id)
      && !isProviderQualifiedModelId(candidate)
    ))
    .map(normalize)
    .filter(Boolean)
    .some((candidate) => (
      candidate === registryModel
      || registryModel.includes(candidate)
      || candidate.includes(registryModel)
    ));
}


export function matchingRegistryIndexes(
  models: readonly RegistryModelEntry[] | null | undefined,
  comparisonModel: ComparisonModel | null | undefined,
): number[] {
  return (models ?? []).reduce<number[]>((indexes, entry, index) => {
    if (registryEntryMatchesModel(entry, comparisonModel)) indexes.push(index);
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
  const routesByProvider = new Map<string, ResolvedComparisonRoute>();

  for (const route of comparisonModel?.routes ?? []) {
    const provider = providersById.get(route.provider);
    if (!provider || Boolean(route.is_local) !== isLocal) continue;
    if (isLocal && !provider.live && !provider.configured) continue;
    if (!routesByProvider.has(provider.id)) {
      routesByProvider.set(provider.id, {
        ...route,
        provider_name: provider.name || route.provider_name || provider.id,
        provider_connected: Boolean(provider.connected),
      });
    }
  }

  return [...routesByProvider.values()].sort((first, second) => {
    if (first.provider_connected !== second.provider_connected) {
      return Number(second.provider_connected) - Number(first.provider_connected);
    }
    return first.provider_name.localeCompare(second.provider_name);
  });
}


export function comparisonRouteToRegistryEntry(
  route: ComparisonRoute,
): ModelRegistryEntry {
  return {
    provider: route.provider,
    model_id: route.model_id,
    is_local: Boolean(route.is_local),
    enabled: true,
    priority: 100,
    cost_in: Number(route.cost_in) || 0,
    cost_out: Number(route.cost_out) || 0,
    context_window: Number(route.context_window) || 8192,
    quality: Number(route.quality) || 2,
    tags: [...(route.tags ?? [])],
  };
}
