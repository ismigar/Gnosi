import type { Catalog } from '../domain/catalog.js';

export function normalizeCatalog(catalog: Catalog): Catalog {
  const providerById = new Map<string, (typeof catalog.providers)[number]>();
  for (const provider of catalog.providers) {
    const normalizedId = provider.id.trim().toLowerCase();
    providerById.set(normalizedId, { ...provider, id: normalizedId });
  }

  const modelByKey = new Map<string, (typeof catalog.models)[number]>();
  for (const model of catalog.models) {
    const providerId = (model.providerId ?? catalog.defaults?.provider ?? '').trim().toLowerCase();
    const normalizedModelId = model.id.trim().toLowerCase();
    const key = `${providerId}/${normalizedModelId}`;
    modelByKey.set(key, {
      ...model,
      id: normalizedModelId,
      providerId,
    });
  }

  return {
    ...catalog,
    providers: [...providerById.values()].sort((a, b) => a.id.localeCompare(b.id)),
    models: [...modelByKey.values()].sort((a, b) => {
      const byProvider = (a.providerId ?? '').localeCompare(b.providerId ?? '');
      return byProvider !== 0 ? byProvider : a.id.localeCompare(b.id);
    }),
  };
}
