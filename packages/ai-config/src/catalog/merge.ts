import type { Catalog } from '../domain/catalog.js';

function normalize(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function mergeProviderMaps(explicitCatalog: Catalog, implicitCatalog: Partial<Catalog>) {
  const providerMap = new Map<string, Catalog['providers'][number]>();

  for (const provider of explicitCatalog.providers ?? []) {
    providerMap.set(normalize(provider.id), provider);
  }

  for (const provider of implicitCatalog.providers ?? []) {
    const key = normalize(provider.id);
    const current = providerMap.get(key);
    if (!current) {
      providerMap.set(key, provider);
      continue;
    }

    // Keep resolved/explicit secret value when new provider data does not contain one.
    const mergedAuth = {
      ...current.auth,
      ...provider.auth,
      value: provider.auth.value ?? current.auth.value,
      token: provider.auth.token ?? current.auth.token,
      ref: provider.auth.ref ?? current.auth.ref,
    };

    providerMap.set(key, {
      ...current,
      ...provider,
      auth: mergedAuth,
    });
  }

  return [...providerMap.values()];
}

function mergeModelMaps(explicitCatalog: Catalog, implicitCatalog: Partial<Catalog>) {
  const modelMap = new Map<string, Catalog['models'][number]>();

  for (const model of explicitCatalog.models ?? []) {
    const key = `${normalize(model.providerId)}/${normalize(model.id)}`;
    modelMap.set(key, model);
  }

  for (const model of implicitCatalog.models ?? []) {
    const key = `${normalize(model.providerId)}/${normalize(model.id)}`;
    modelMap.set(key, model);
  }

  return [...modelMap.values()];
}

export function mergeCatalogs(explicitCatalog: Catalog, implicitCatalog: Partial<Catalog>): Catalog {
  const providers = mergeProviderMaps(explicitCatalog, implicitCatalog);
  const models = mergeModelMaps(explicitCatalog, implicitCatalog);

  if (explicitCatalog.mode === 'merge') {
    return {
      ...explicitCatalog,
      providers,
      models,
      defaults: {
        ...(implicitCatalog.defaults ?? {}),
        ...(explicitCatalog.defaults ?? {}),
      },
    };
  }

  return {
    ...explicitCatalog,
    providers: implicitCatalog.providers ?? explicitCatalog.providers,
    models: implicitCatalog.models ?? explicitCatalog.models,
  };
}
