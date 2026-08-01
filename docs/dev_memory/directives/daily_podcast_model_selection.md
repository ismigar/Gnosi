# Daily Podcast AI Model Selection

## Objective

Make the Reader daily-podcast script model configurable in Settings and route
generation through Gnosi's unified AI provider layer instead of a direct,
hard-coded Groq client.

## Configuration

- Persist the selection under `settings.reader.podcast` with `provider` and
  `model` fields.
- An empty selection means "default AI model" and resolves through the current
  default-agent path.
- An explicit selection must match an enabled row in the configured AI model
  registry. Never offer or execute inactive catalog entries.
- Store provider and model together because the same model identifier can be
  exposed through more than one provider.

## Backend

- Resolve configuration fresh for each generation so Settings changes apply
  without restarting the native backend.
- Instantiate explicit selections through `agent.factory.get_llm` and
  `resolve_provider_api_key`; use `get_default_llm_with_meta` only for the
  explicit default option.
- Use LangChain messages for the existing system and batch prompts and record
  returned token usage through the shared usage ledger.
- Both manual and scheduled generation must continue to call the same service.
- Remove provider-specific rate-limit sleeps. Provider throttling must not be
  encoded as a fixed Groq free-tier delay.

## Settings UI

- Add a Reader entry to the Connections group and a Daily podcast section.
- Populate one grouped selector from enabled `configured_models` returned by
  `GET /api/ai/models`, reusing the agent model-selection semantics.
- Keep the default-model option available. If a persisted route becomes
  inactive, keep it visible as unavailable so opening and saving Settings does
  not silently destroy the selection.
- Add every visible string to Catalan, English, Spanish, and French locales.

## Restrictions and Edge Cases

- Do not read the API key or configuration at module import time: native
  Settings changes would otherwise require a backend restart.
- Do not fall back silently when an explicitly selected route is disabled,
  missing, or cannot be instantiated. Report an actionable generation error.
- Do not couple text-model selection to gTTS voice settings; they are separate
  concerns.
- Tests that replace `load_params` must import `agent.factory` first because the
  factory still resolves its internal base directory from configuration at
  module import time. Replacing configuration before that import produces a
  test-only incomplete `Config` object failure unrelated to podcast routing.
- Preserve the existing article filtering, batching, prompts, MP3 naming,
  manual endpoint, scheduler task, and generation lock.

## Verification

1. Unit-test default and explicit route resolution, disabled-route rejection,
   LangChain invocation, and usage recording.
2. Test the Settings model-option normalization and persisted unavailable route.
3. Run backend targeted tests and frontend unit tests.
4. Run the frontend production build.
5. Verify Settings visually and through the DOM in a browser, then exercise the
   configuration API round trip and the podcast generation path with a mocked
   model to avoid paid external calls.
