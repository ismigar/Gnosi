const normalize = (value) => String(value || '').toLocaleLowerCase().replace(/[^a-z0-9]+/g, '');

export function registryEntryMatchesModel(entry, comparisonModel) {
    const exactRoute = (comparisonModel?.routes || []).some((route) => (
        route.provider === entry?.provider && route.model_id === entry?.model_id
    ));
    if (exactRoute) return true;

    const registryModel = normalize(entry?.model_id);
    if (!registryModel) return false;
    return [comparisonModel?.slug, comparisonModel?.name]
        .map(normalize)
        .filter(Boolean)
        .includes(registryModel);
}

export function matchingRegistryIndexes(models, comparisonModel) {
    return (models || []).reduce((indexes, entry, index) => {
        if (registryEntryMatchesModel(entry, comparisonModel)) indexes.push(index);
        return indexes;
    }, []);
}

export function catalogModelToRegistryEntry(provider, model) {
    return {
        provider: provider.id,
        model_id: model.id,
        is_local: Boolean(provider.is_local),
        enabled: true,
        priority: 100,
        cost_in: Number(model.cost_in) || 0,
        cost_out: Number(model.cost_out) || 0,
        context_window: Number(model.context_window) || 8192,
        quality: Number(model.quality) || 2,
        tags: [...(model.tags || [])],
    };
}

export function suggestedCatalogModel(provider, comparisonModel) {
    if (!provider) return null;
    const route = (comparisonModel?.routes || []).find((item) => item.provider === provider.id);
    if (route) {
        const exact = (provider.models || []).find((model) => model.id === route.model_id);
        if (exact) return exact;
    }
    const comparisonKeys = [comparisonModel?.slug, comparisonModel?.name].map(normalize).filter(Boolean);
    return (provider.models || []).find((model) => (
        comparisonKeys.includes(normalize(model.id)) || comparisonKeys.includes(normalize(model.name))
    )) || null;
}
