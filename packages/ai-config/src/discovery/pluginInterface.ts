import type { Catalog } from '../domain/catalog.js';

export interface ProviderDiscoveryContext {
  profileName?: string;
  env?: Record<string, string | undefined>;
}

export interface ProviderDiscoveryPlugin {
  id: string;
  order: number;
  discover: (context: ProviderDiscoveryContext) => Promise<Partial<Catalog>>;
}
