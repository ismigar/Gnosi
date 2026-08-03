import { materializeRuntimeConfig } from '../io/configLoader.js';
import { resolveAuthSecret, type SecretResolverContext } from '../secrets/resolver.js';
import type { ProviderDiscoveryPlugin } from '../discovery/pluginInterface.js';
import { runProviderDiscovery } from '../discovery/discoveryEngine.js';
import { mergeCatalogs } from '../catalog/merge.js';
import { normalizeCatalog } from '../catalog/normalize.js';
import { selectModel, type SelectionInput } from '../selection/selector.js';
import type { Catalog } from '../domain/catalog.js';

export interface ResolveEffectiveModelContext extends SelectionInput, SecretResolverContext {
  plugins?: ProviderDiscoveryPlugin[];
}

export async function resolveEffectiveModel(rawConfig: unknown, context: ResolveEffectiveModelContext = {}) {
  const runtimeConfig = materializeRuntimeConfig(rawConfig, { env: context.env });

  const explicitCatalog: Catalog = {
    providers: runtimeConfig.providers.map((provider) => ({
      ...provider,
      auth: resolveAuthSecret(provider.auth, provider.id, {
        env: context.env,
        profiles: runtimeConfig.profiles,
        profileName: context.profileName,
      }),
    })),
    models: runtimeConfig.models,
    mode: runtimeConfig.mode,
    defaults: {
      provider: runtimeConfig.defaults.provider,
      model: runtimeConfig.defaults.model,
      byContext: runtimeConfig.defaults.byContext,
    },
  };

  const discovered = await runProviderDiscovery(context.plugins ?? [], {
    profileName: context.profileName,
    env: context.env,
  });

  const merged = mergeCatalogs(explicitCatalog, discovered);
  const normalized = normalizeCatalog(merged);

  return {
    catalog: normalized,
    selection: selectModel(normalized, {
      requested: context.requested,
      contextId: context.contextId,
      fallback: context.fallback,
      allowlist: context.allowlist ?? runtimeConfig.allowlist,
    }),
  };
}
