import type { Provider } from './provider.js';
import type { Model } from './model.js';

export type CatalogMode = 'merge' | 'replace';

export interface Catalog {
  providers: Provider[];
  models: Model[];
  mode?: CatalogMode;
  defaults?: {
    provider?: string;
    model?: string;
    byContext?: Record<string, { provider?: string; model?: string; fallback?: string }>;
  };
  meta?: Record<string, unknown>;
}
