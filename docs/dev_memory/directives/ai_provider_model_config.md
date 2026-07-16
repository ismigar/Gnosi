# Directive: Unified Architecture for AI Providers and Models

## Objective
Implement a unified layer for managing AI providers and models, with dynamic discovery, secret normalization, and runtime model selection.

--

## Layer Schema

1. **Domain and Schema**

- Define types: Provider, Model, Catalog, AuthSource, SelectionResult.
- Strict validation (zod/pydantic).

2. **Loading and Validation**

- Read configuration files (files, includes, environment variables).
- Basic and extended validation (plugins).

3. **Secret Resolution**

- Priority: environment > profiles > configuration.
- Support for references (env, file, exec).

4. **Provider Discovery**

- Plugins/adapters with stable ordering.
- Dynamic catalog at runtime.

5. **Effective Catalog**

- Explicit + implicit merge.
- Normalization and snapshot.

6. **Model Selection**

- Rules: default, fallback, allowlist.
- Safe normalization and fallback.

7. **Testing**

- Unit tests per module.
- End-to-end integration.

8. **Documentation**

- Supplier configuration and onboarding guide.

---

## Suggested Structure (Node.js/TypeScript)

```
monorepo/packages/ai-config/ 
src/ 
domain/ 
provider.ts 
model.ts 
catalog.ts 
auth.ts 
selection.ts 
schema/ 
provider.schema.ts 
model.schema.ts 
io/ 
configLoader.ts 
configValidator.ts 
secrets/ 
resolve.ts 
discovery/ 
pluginInterface.ts 
discoveryEngine.ts 
catalog/ 
merge.ts 
normalize.ts 
snapshot.ts 
selection/ 
selector.ts 
runtime/ 
resolveEffectiveModel.ts 
__tests__/ 
... 
README.md
```

## Suggested Structure (Python)

```
monorepo/packages/ai_config/ 
    domain/ 
        provider.py 
        model.py
        catalog.py
        auth.py
        selection.py
        schema/
        provider_schema.py
        model_schema.py
        io/
        config_loader.py
        config_validator.py
        secrets/
        resolver.py
        discovery/
        plugin_interface.py
        discovery_engine.py
        catalog/
        merge.py
        normalize.py
        snapshot.py
        selection/
        selector.py
        runtime/
        resolve_effective_model.py
        tests/

...
README.md
```

---

## Rules and Restrictions
- A new provider should only be added via plugin/adapter, without modifying the core.
- Invalid configurations should fail with a clear and actionable error.
- Secrets should never be persisted in clear data if they come from references.
- The effective catalog should be deterministic for the same input.
- The final selection respects default, fallback, and allowlist.
- Regression tests for migrations and compatibility.

---

## Workflow
1. Create types and schemas.
2. Implement configuration loading and validation.
3. Resolve priority secrets and references.
4. Implement provider discovery (plugins/adapters).
5. Catalog merge and normalization.
6. Model selector with rules.
7. Unit and integration testing.
8. Documentation and examples.

--

## Testing
- Unit tests: parser, validator, resolver, normalizer, selector.
- Integration tests: minimal configuration flow, multiple providers, dynamic plugin, merge/replace.
- Edge cases: no models, implicit model, missing credentials, aliases/normalization.

--

## Rollout
1. Feature flag for new path.
2. Compare results from old vs. new path.
3. Enable by default and maintain fallback.
4. Remove the old implementation after validation.

--

## Model Catalog for the Router Registry (implemented 2026-07-16)

The router registry UI (Models del router) no longer asks the user to remember
provider/model ids: hierarchical dropdowns Provider → Model auto-fill cost,
context window, capabilities and quality, all editable afterwards.

- **Primary source**: models.dev `api.json` (open-source database used by the
  OpenCode harness; no API key). Transformed to a compact schema in
  `backend/agent/model_catalog.py` (pure `build_catalog`, unit-tested).
- **Layers**: remote fetch (24h TTL) → disk cache in `GNOSI_LOCAL_DATA/cache`
  or `~/.cache/gnosi` (never the vault/OneDrive) → vendored snapshot
  `backend/data/model_catalog.json` (zero-network fallback; regenerate with
  `python -m backend.scripts.refresh_model_catalog`).
- **Live overlay**: models actually installed in Ollama via `GET /api/tags`
  (autodetected base URL, Docker vs native).
- **Endpoint**: `GET /api/ai/model-catalog` (async, loader runs in a thread).
- Costs are USD per **1M tokens** across registry, catalog and UI.

### Restrictions / Edge Cases
- Do not scrape artificialanalysis.ai → fragile HTML and it HAS an official
  Data API (key required, 1k req/day) → if quality benchmarks are ever needed,
  integrate their API as optional enrichment instead.
- Do not fetch the remote catalog inline in an async endpoint → blocks the
  event loop → wrap the sync loader in `asyncio.to_thread` (same lesson as
  uploads, PR #813).
- `backend/data/*.json` is gitignored → a vendored JSON there silently drops
  out of the repo → keep the explicit `!backend/data/model_catalog.json`
  exception in `monorepo/apps/gnosi/.gitignore`.
- Do not default Ollama to `host.docker.internal` → breaks native installs →
  use `env_config.default_ollama_base_url()` (autodetects Docker vs native).
- Registry rows whose provider/model are not in the catalog must render as an
  extra option / free-text ("Personalitzat…") → otherwise saved values blank
  out visually and a save would destroy them.
- Capability tags (`fast/code/vision/long/tools/reasoning`) are DATA matched
  verbatim by `model_router.py` → never translate them in the UI.
- i18n wrappers with a `(key, opts)` signature swallow a third argument → for
  interpolated defaults pass `{ defaultValue, ...vars }` as the second arg
  (the `{{source}}` hint bug found in browser QA).

--

## Notes
- Adapt module names according to repository conventions.
- Keep documentation and examples up to date.
- Review AGENTS.md for the learning and consolidation cycle.
- Note: En paquetes TypeScript con moduleResolution NodeNext, no usar imports relativos sin extension porque rompe el build. Usar siempre sufijo .js en los imports relativos.
- Note: Con zod v4, no usar z.record con un solo argumento porque falla tipado/compilacion. Usar siempre z.record(clave, valor).
- Note: No persistir nunca api_key en params.yaml (ni por migraciones desde entorno). Guardar solo credential_ref y resolver secretos desde keychain/secret store en runtime.