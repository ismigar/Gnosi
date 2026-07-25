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
- Deleting a provider MUST cascade to all three stores: the config entry,
  the keychain credential AND its router-registry rows (filter the EFFECTIVE
  registry, materializing the seed default if needed). Leaving the credential
  made the router keep using a "deleted" provider (resolve falls back to the
  keychain with no config entry); leaving the rows recreates the
  models-without-provider confusion.
- `is_provider_connected` must honour `enabled: false` → a toggled-off
  provider is NOT connected, whatever credentials it has, matching the
  router's availability semantics (otherwise the UI groups it as usable while
  the router silently skips its rows).
- The macOS keychain is MACHINE-GLOBAL: an "isolated" QA backend (own vault,
  own params.yaml, own port) still reads/writes the SAME keychain as the real
  instance. Never exercise destructive credential flows (provider delete,
  key rotation) with real provider ids — use a throwaway id like
  `qa-fake-prov`, whose generated key name cannot collide. Incident 2026-07-21:
  a cascade E2E ran DELETE /providers/groq on the isolated backend and wiped
  the user's real Groq key.
- i18n wrappers with a `(key, opts)` signature swallow a third argument → for
  interpolated defaults pass `{ defaultValue, ...vars }` as the second arg
  (the `{{source}}` hint bug found in browser QA).

--

## Any-provider catalog + spend cap (implemented 2026-07-20)

The unified layer described above is now materialized around models.dev,
OpenClaw-style: every provider is configurable, model lists self-update, and a
monthly spend ceiling in the Settings currency governs the router.

- **Full catalog**: `build_catalog` no longer whitelists providers — ALL
  models.dev providers (~167, ~5.5k models) flow through, featured ones first
  (`FEATURED_PROVIDERS` order) then the rest alphabetically. Each provider
  carries connection metadata: `env` (API-key env var names), `api`
  (OpenAI-compatible base URL), `npm` (SDK hint), `doc`.
- **OpenAI-compat bridge**: providers that ship a dedicated SDK on models.dev
  (no `api` field) get their base URL from `OPENAI_COMPAT_URLS`
  (google/xai/cohere/perplexity/together/fireworks/cerebras/deepinfra…);
  `factory.get_llm` falls back to a generic `ChatOpenAI(base_url=…)` for ANY
  catalog provider with a known URL → no new SDK dependencies.
- **Connection status**: `/api/ai/model-catalog` annotates providers with
  `connected` (config credential, env var, or local). `/api/ai/catalog` (the
  connect modal) is now catalog-fed: `models_count`, `base_url_hint`, `env`,
  `doc`, `connected`, `configured`. The registry UI groups providers into
  Connected/All optgroups and badges rows whose provider has no credential.
- **Spend ledger**: `UsageStore` v2 records tokens AND `cost_usd` per
  `provider:model` per month; `generate_text` and the agent SSE loop feed it
  from `usage_metadata` (`record_llm_usage`, best-effort, never raises).
- **Money cap**: `ai.budget.monthly_cost_cap` is stored in the Settings
  currency (`settings.currency`); `services/fx_rates.py` converts via
  frankfurter.app (ECB) with disk cache + static fallback. `budget_status()`
  merges cap+ledger+rate; `route_model` receives `cost_cap_usd`/`spent_usd`
  INJECTED (core stays pure): ≥80 % → budget-tight (prefer local/cheap), ≥100 %
  → only zero-cost models (reason `budget_exhausted` if none).
- **Endpoints**: `GET /api/ai/usage` (period spend in USD + currency, cap,
  ratio, per-model rows); `PUT /api/ai/models` sanitizes the budget payload
  (whitelist of typed keys).

### Restrictions / Edge Cases (learned)
- `Config.paths` keys do NOT mirror env var names → the cache/ledger base is
  `paths["LOCAL_CACHE"]` (or `LOCAL_DATA`), **never** `paths.get("GNOSI_LOCAL_DATA")`
  → that lookup silently returned None and the usage ledger was never written
  (and the catalog cache always fell back to `~/.cache/gnosi`).
- Bump `CATALOG_SCHEMA` whenever the compact catalog gains fields → caches
  with an older schema must be treated as stale, otherwise the new fields
  only appear after the 24 h TTL.
- `UsageStore` is constructed ad-hoc per call → the write lock must be
  MODULE-level and the read-modify-write cycle must re-read the file under
  the lock (cf. memory `feedback_json_store_rmw_race_pattern`), with an
  atomic `os.replace` write.
- Do not mutate the memoized catalog when annotating `connected` in the
  endpoint → copy the dict, or a stale connection state gets frozen into the
  in-process cache.
- For UNconfigured providers, connection checks must skip the keychain (env
  vars only) → keys saved from the UI always write a config entry, and ~160
  keychain probes per catalog render would be pathological.
- FX conversion must never raise nor divide by zero → layered
  remote→disk→static with a final neutral 1.0 rate; cap semantics stay
  conservative when the rate source degrades.
- Full-suite pytest with the native backend alive runs `test_vault_trash`
  (live-E2E) because an earlier test's `load_dotenv` leaks the real vault path
  → pre-existing quirk (memory `feedback_e2e_skipif_dotenv_import_order`);
  isolated runs skip it correctly.

--

## Notes
- Adapt module names according to repository conventions.
- Keep documentation and examples up to date.
- Review AGENTS.md for the learning and consolidation cycle.
- Note: TypeScript packages using NodeNext module resolution must include the
  `.js` suffix in relative imports or the build fails.
- Note: With Zod v4, never call `z.record` with one argument because type
  checking and compilation fail. Always use `z.record(key, value)`.

## Artificial Analysis comparison feed (implemented 2026-07-26)

The Settings model-comparison dashboard uses the official Artificial Analysis
Data API, never HTML scraping. The backend owns the API key and follows every
pagination page so the UI receives the complete language-model set tracked by
Artificial Analysis rather than a hand-maintained shortlist.

- Fetch `/api/v2/language/models/free` on every dashboard open.
- Keep `ARTIFICIAL_ANALYSIS_API_KEY` server-side; never send it to the browser.
- Merge optional context-window and capability metadata from the existing live
  models.dev catalog when the Free response omits Pro-only fields.
- Derive the recommended role deterministically from benchmark, price,
  performance, context, and reasoning signals; return the reasons with the role.
- Surface authentication, quota, and network failures as localized dashboard
  states. Never silently present the former five-row sample as current data.

### Restrictions / Edge Cases

- Do not scrape artificialanalysis.ai → the official Data API is stable and
  scraping violates the integration architecture.
- Do not stop at page one → the Free endpoint currently paginates at 200 rows,
  so frontier or long-tail models may otherwise be omitted.
- Do not call Artificial Analysis from React → exposes the API key and shares
  the organisation quota with every browser client.
- The Free tier does not include every Pro metadata field. Missing values must
  remain unknown or come from an explicitly attributed models.dev enrichment;
  they must never be invented.
- Call the models.dev loader with its public `force_refresh` parameter. Do not
  invent a `refresh` keyword: unit tests must exercise the same keyword used in
  production so a permissive mock cannot hide a runtime signature mismatch.
- Note: Never persist `api_key` in `params.yaml`, including during environment
  migrations. Store only `credential_ref` and resolve secrets from Keychain or
  the secret store at runtime.
