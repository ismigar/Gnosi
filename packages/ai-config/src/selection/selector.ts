import type { Catalog } from '../domain/catalog.js';
import type { SelectionResult } from '../domain/selection.js';

export interface SelectionInput {
  requested?: string;
  contextId?: string;
  fallback?: string;
  allowlist?: string[];
}

function parseProviderModel(ref: string): { provider?: string; model: string } {
  if (ref.includes('/')) {
    const [provider, model] = ref.split('/');
    return { provider: provider.trim().toLowerCase(), model: model.trim().toLowerCase() };
  }
  return { model: ref.trim().toLowerCase() };
}

function isAllowed(provider: string, model: string, allowlist: string[]): boolean {
  if (allowlist.length === 0) {
    return true;
  }
  const full = `${provider}/${model}`;
  return allowlist.includes(full) || allowlist.includes(model);
}

export function selectModel(catalog: Catalog, input: SelectionInput = {}): SelectionResult {
  const attempted: Array<{ provider: string; model: string }> = [];
  const allowlist = input.allowlist ?? [];

  const contextDefaults = input.contextId ? (catalog.defaults?.byContext?.[input.contextId] ?? {}) : {};
  const primaryRef =
    input.requested ??
    (contextDefaults.provider && contextDefaults.model
      ? `${contextDefaults.provider}/${contextDefaults.model}`
      : contextDefaults.model) ??
    (catalog.defaults?.provider && catalog.defaults.model
      ? `${catalog.defaults.provider}/${catalog.defaults.model}`
      : catalog.defaults?.model);

  const fallbackRef = input.fallback ?? contextDefaults.fallback;

  const candidates = [primaryRef, fallbackRef].filter((v): v is string => Boolean(v));

  for (const ref of candidates) {
    const parsed = parseProviderModel(ref);
    const model = catalog.models.find((entry) => {
      const providerMatches = parsed.provider ? entry.providerId === parsed.provider : true;
      return providerMatches && entry.id === parsed.model;
    });
    if (!model || !model.providerId) {
      continue;
    }
    attempted.push({ provider: model.providerId, model: model.id });
    if (!isAllowed(model.providerId, model.id, allowlist)) {
      continue;
    }
    return {
      provider: model.providerId,
      model: model.id,
      fallbackUsed: ref === fallbackRef,
      allowlistApplied: allowlist,
      attempted,
      reason: ref === fallbackRef ? 'fallback_match' : 'primary_match',
    };
  }

  throw new Error('No model could be selected with current defaults/fallback/allowlist rules');
}
