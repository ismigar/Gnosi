import type { Catalog } from '../domain/catalog.js';

export function buildCatalogSnapshot(catalog: Catalog): string {
  const stable = {
    ...catalog,
    providers: [...catalog.providers].sort((a, b) => a.id.localeCompare(b.id)),
    models: [...catalog.models].sort((a, b) => {
      const byProvider = (a.providerId ?? '').localeCompare(b.providerId ?? '');
      return byProvider !== 0 ? byProvider : a.id.localeCompare(b.id);
    }),
  };

  return JSON.stringify(stable, null, 2);
}
