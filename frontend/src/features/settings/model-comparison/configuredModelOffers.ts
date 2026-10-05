import type { AiModelCatalogProvider, AiModelComparisonEntry, AiModelRegistryEntry } from '../../../shared/api/ai';

type Provider = Pick<AiModelCatalogProvider, 'id' | 'enabled' | 'has_api_key' | 'connected'
    | 'is_local' | 'live' | 'configured' | 'validated_models'>;

/** A stored credential alone may be an unfinished or unsuccessful setup. */
export function configuredModelOffers(models: readonly AiModelComparisonEntry[], providers: readonly Provider[],
    registry: readonly AiModelRegistryEntry[], selection: string): readonly AiModelComparisonEntry[] {
    if (selection === 'all') return models;
    const active = new Set(registry.filter(row => row.enabled).map(row => row.provider));
    const ready = new Set(providers.filter(provider => provider.enabled && (
        provider.is_local ? provider.live || provider.configured && active.has(provider.id)
            : provider.has_api_key && provider.connected
                && (active.has(provider.id) || (provider.validated_models?.length ?? 0) > 0)
    )).map(provider => provider.id));
    return models.map(model => ({ ...model, routes: model.routes.filter(route => selection === 'configured'
        ? ready.has(route.provider) : route.provider === selection) }));
}
