import type { Catalog } from '../domain/catalog.js';
import type { ProviderDiscoveryContext, ProviderDiscoveryPlugin } from './pluginInterface.js';

export async function runProviderDiscovery(
  plugins: ProviderDiscoveryPlugin[],
  context: ProviderDiscoveryContext = {},
): Promise<Partial<Catalog>> {
  const ordered = [...plugins].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const aggregate: Catalog = { providers: [], models: [] };

  for (const plugin of ordered) {
    const result = await plugin.discover(context);
    if (result.providers) {
      aggregate.providers.push(...result.providers);
    }
    if (result.models) {
      aggregate.models.push(...result.models);
    }
  }

  return aggregate;
}
