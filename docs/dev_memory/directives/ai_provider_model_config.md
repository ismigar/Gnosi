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
- Provider deletion must also remove every provider API-key variable from
  Gnosi-managed `.env_shared`/`.env` files and the live process environment.
  Environment-backed legacy migration must additionally respect the persisted
  `ai.disconnected_providers` tombstone because values injected externally by
  a service manager cannot be edited by the backend. Without both actions,
  `load_params()` can add the provider back on the next Settings open.
  Explicit credential save or re-enabling clears the tombstone.
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

- Fetch `/api/v2/language/models/free` only when the 24-hour complete cache is
  absent or expired. The observed organization quota is 100 requests per reset
  window, and a complete pagination pass consumes multiple requests.
- Keep `ARTIFICIAL_ANALYSIS_API_KEY` server-side; never send it to the browser.
- Merge optional context-window and capability metadata from the existing live
  models.dev catalog when the Free response omits Pro-only fields.
- Derive the recommended role deterministically from benchmark, price,
  performance, context, and reasoning signals; return the reasons with the role.
- Surface authentication, quota, and network failures as localized dashboard
  states. Never silently present the former five-row sample as current data.
  When no complete cache exists, say so explicitly and include the upstream
  `X-Ratelimit-Reset` time when Artificial Analysis returns it.
- Persist the last complete Artificial Analysis payload outside the vault. When
  quota or transient upstream access fails, serve that attributed cache; if no
  cache exists yet, build an explicitly attributed models.dev comparison feed.
  The UI must warn that Artificial Analysis-only benchmark fields may be absent.
- Reuse a complete Artificial Analysis cache for 24 hours before requesting all
  pagination pages again. On any configuration or upstream failure, prefer the
  last complete cache even when it is older; only use models.dev when no
  complete Artificial Analysis cache exists.

### Restrictions / Edge Cases

- Do not scrape artificialanalysis.ai → the official Data API is stable and
  scraping violates the integration architecture.
- Do not stop at page one → the Free endpoint currently paginates at 200 rows,
  so frontier or long-tail models may otherwise be omitted.
- Do not refetch every pagination page on each modal open → repeated UI checks
  consume the daily quota and can prevent the first complete cache from being
  produced → reuse a complete cache for 24 hours, then refresh it atomically.
- Do not let a partial Artificial Analysis refresh replace previously known
  metrics with nulls → Free-tier fields can disappear between responses and
  make a healthy cache progressively emptier → merge missing metrics from the
  last successful cache before the atomic write. Complete missing price and
  context values only from an exact models.dev match and retain per-field
  attribution.
- Tests that exercise a successful fetch must mock both cache reads and cache
  writes → mocking only `_read_cache` still lets `_write_cache` persist fixture
  rows into the native runtime cache → capture writes in memory and assert them.
- Do not call Artificial Analysis from React → exposes the API key and shares
  the organisation quota with every browser client.
- The Free tier does not include every Pro metadata field. Missing values must
  remain unknown or come from an explicitly attributed models.dev enrichment;
  they must never be invented.
- Do not render source-wide unavailable metrics as columns full of em dashes →
  this makes the fallback look broken and obscures its useful data → derive
  column visibility from the active payload and hide task-profile controls when
  every model is unrated. Keep sporadic missing values visible as unknown.
- Call the models.dev loader with its public `force_refresh` parameter. Do not
  invent a `refresh` keyword: unit tests must exercise the same keyword used in
  production so a permissive mock cannot hide a runtime signature mismatch.
- The comparison table is intentionally wider than the modal. Keep the first
  model column and the final availability column sticky, and expose explicit horizontal
  navigation controls. Keep those controls sticky while the table body is
  vertically scrolled; a control row that scrolls away, or a scrollbar only at
  the bottom of hundreds of rows, is not discoverable enough on desktop or
  mobile. The sticky control surface must also cover the comparison body's
  top padding so table rows cannot show through between the modal header and
  the navigation bar.
- Do not synchronize the horizontal scrollbar with the modal body → the body
  owns vertical scrolling and moving it leaves the table columns unchanged.
  Do not make the table wrapper a horizontal scroll container either → that
  captures the vertically sticky header and offsets it inside the wrapper.
  Instead, keep the wrapper clipped and synchronize the scrollbar with a CSS
  translation applied only to non-sticky cells. Use opaque sticky masks above
  and below so rows cannot bleed through the navigation and scrollbar surfaces.
  The upper mask must extend below the navigation control and sit below the
  table header in the stacking order; matching only the control's own box
  leaves a responsive gap where the preceding data row remains visible.
- The comparison modal must handle keyboard scrolling at the window level while
  leaving inputs, selects, buttons, links and editable fields untouched. Map
  ArrowLeft/Right to the table's horizontal scrollbar, ArrowUp/Down and
  PageUp/PageDown to incremental vertical scrolling, and Home/End to the top
  or bottom of the modal body.
- The comparison is also a configuration surface for the router. Every row
  exposes the effective enabled state; enabling opens a guided local/remote
  route picker, while disabling keeps the registry row but marks it disabled.
- Keep activation inside the comparison modal's normal document flow. Expand
  the guided route form as a detail row immediately after the selected model
  and before the next model, without a duplicated setup header, and let it use
  the modal body's scroll. Do not open a second modal/backdrop over the
  comparison because its sticky table surfaces can cross the nested dialog and
  the interaction diverges from the rest of Settings.
- Do not size the inline activation form from the table's intrinsic width → the
  wide translated columns make fields and actions overflow beyond the visible
  modal → measure the clipped table viewport and constrain the detail form to
  that width, including its inputs and footer.
- Artificial Analysis benchmark variants do not contain deployable provider
  ids. Match them to exact models.dev provider/model routes server-side and
  send those routes with the comparison payload. Treat each exact route as the
  source of truth: activate a single route directly, ask only for the provider
  when several providers expose the same compared model, and derive the model
  id silently from the selected route. Deduplicate same-provider aliases
  deterministically. Never ask the user to select the model again. If no exact
  route exists, block automatic activation instead of offering an unrelated
  catalog model or inventing an id from the display name.
- Reuse an existing provider credential silently. Request an API key only when
  the chosen remote provider has no configured or environment credential, and
  persist it through the secure credentials endpoint before enabling the
  provider and registry row. Do not add a separate "API key required" notice
  immediately before the API-key field: the field label and helper already
  communicate that requirement, so the extra notice is redundant.
- When the comparison error screen tells the user to paste an Artificial
  Analysis key, always render the key field. Do not restrict it to selected
  backend error codes: unknown or normalized upstream failures otherwise show
  a "paste it below" instruction with no input below it.
- A local route must come from a live or explicitly configured local provider.
  Do not present static local-provider catalog entries as installed models;
  this otherwise makes an unavailable LM Studio/Ollama model look runnable.
- Comparison mutations must preserve the complete budget payload and notify
  the router-registry Settings component through `gnosi-ai-models-changed`, so
  both configuration surfaces stay synchronized.
- Agent-specific model selectors must use only explicitly configured registry
  rows whose `enabled` value is exactly true. Do not populate them from the
  router's effective/default registry: those defaults are an internal runtime
  fallback, not models the user activated in Settings. Ignore unchanged default
  rows persisted by older comparison clients, and base new comparison
  mutations on the explicit rows so defaults are not copied again. Reload the
  selector on `gnosi-ai-models-changed` so an open Settings modal stays
  synchronized.
- The router has no executable default model registry. An absent or empty
  `ai.models` configuration means that no model is active. Keep the retired
  seed list only as a migration signature for discarding unchanged rows
  persisted by older clients; never route through it.
- Task profiles are five disjoint benchmark-percentile bands. Use lower-inclusive
  and upper-exclusive bounds for every intermediate band: Worker `<20`, Administrative
  `20–40`, Documentalist `40–60`, All-rounder `60–80`, and Expert `≥80`. Models
  without an intelligence benchmark are `unrated`; never force them into an
  intermediate band from price, speed, context, name, or capability signals.
  Those overrides make a selected middle profile leak models from above or below.
- Do not present provider cards and router-registry rows as parallel primary
  model-management surfaces once the comparison can enable and configure a
  route. This duplicates the workflow and makes users question which surface
  is authoritative. Keep credential maintenance, connection diagnostics and
  manual router tuning in one collapsed advanced section; the comparison is
  the default model-management path.
- Note: Never persist `api_key` in `params.yaml`, including during environment
  migrations. Store only `credential_ref` and resolve secrets from Keychain or
  the secret store at runtime.
