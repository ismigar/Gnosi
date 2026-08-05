const normalize = (value) => String(value || '').toLocaleLowerCase().replace(/[^a-z0-9]+/g, '');

export function registryEntryMatchesModel(entry, comparisonModel) {
    const exactRoute = (comparisonModel?.routes || []).some((route) => (
        route.provider === entry?.provider && route.model_id === entry?.model_id
    ));
    if (exactRoute) return true;

    const registryModel = normalize(entry?.model_id);
    if (!registryModel) return false;
    return [comparisonModel?.slug, comparisonModel?.name, comparisonModel?.id]
        .map(normalize)
        .filter(Boolean)
        .some((comp) => comp === registryModel || registryModel.includes(comp) || comp.includes(registryModel));
}

export function matchingRegistryIndexes(models, comparisonModel) {
    return (models || []).reduce((indexes, entry, index) => {
        if (registryEntryMatchesModel(entry, comparisonModel)) indexes.push(index);
        return indexes;
    }, []);
}

export function comparisonRoutesForMode(comparisonModel, providers, mode) {
    const isLocal = mode === 'local';
    const providersById = Object.fromEntries(
        (providers || []).map((provider) => [provider.id, provider]),
    );
    const routesByProvider = new Map();

    for (const route of comparisonModel?.routes || []) {
        const provider = providersById[route.provider];
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

export function comparisonRouteToRegistryEntry(route) {
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
        tags: [...(route.tags || [])],
    };
}
