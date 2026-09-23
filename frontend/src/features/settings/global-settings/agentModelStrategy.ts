import type { SettingsModel } from './types';

export interface AgentModelRoute { provider: string; model: string }
export interface AgentModelStrategy {
  schema_version: 1;
  mode: 'pinned' | 'resilient' | 'adaptive';
  decision_engine: 'rules' | 'jev';
  allowed_models: AgentModelRoute[];
}

export const MAX_ALTERNATIVES = 8;
export const isLocalModelProvider = (provider: string) => (
  ['ollama', 'lmstudio', 'local', 'llama-cpp', 'llamacpp', 'llama.cpp', 'generic'].includes(provider.toLowerCase())
);
export const modelRouteKey = (route: AgentModelRoute) => `${route.provider}:${route.model}`;

export function readModelStrategy(raw: unknown): AgentModelStrategy {
  const data = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const mode = data.mode === 'adaptive' || data.mode === 'resilient' ? data.mode : 'pinned';
  const routes: AgentModelRoute[] = [];
  if (Array.isArray(data.allowed_models)) {
    for (const item of data.allowed_models as unknown[]) {
      if (!item || typeof item !== 'object') continue;
      const route = item as Record<string, unknown>;
      if (typeof route.provider !== 'string' || typeof route.model !== 'string') continue;
      const normalized = { provider: route.provider.trim().toLowerCase(), model: route.model.trim() };
      if (!normalized.provider || !normalized.model || routes.some(existing => modelRouteKey(existing) === modelRouteKey(normalized))) continue;
      routes.push(normalized);
    }
  }
  return { schema_version: 1, mode, decision_engine: data.decision_engine === 'jev' ? 'jev' : 'rules', allowed_models: routes.slice(0, MAX_ALTERNATIVES) };
}

export function compatibleAlternatives(provider: string, model: string, registry: SettingsModel[]): SettingsModel[] {
  const primary = registry.find(row => row.provider === provider && row.model_id === model);
  const protectedTags = (primary?.tags || []).filter(tag => tag === 'tools' || tag === 'vision');
  return registry.filter(row => row.enabled === true && row.provider && row.model_id
    && !(row.provider === provider && row.model_id === model)
    && isLocalModelProvider(row.provider) === isLocalModelProvider(provider)
    && protectedTags.every(tag => row.tags?.includes(tag)));
}

export function reconcileModelStrategy(strategy: AgentModelStrategy, provider: string, model: string, registry: SettingsModel[]): AgentModelStrategy {
  const eligible = new Set(compatibleAlternatives(provider, model, registry).map(row => `${row.provider}:${row.model_id}`));
  return {
    ...strategy,
    decision_engine: isLocalModelProvider(provider) ? 'rules' : strategy.decision_engine,
    allowed_models: strategy.allowed_models.filter(route => eligible.has(modelRouteKey(route))),
  };
}
