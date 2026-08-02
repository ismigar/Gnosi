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
- Resolve the interface language fresh for every generation and use the same
  normalized language for both the LLM script prompt and gTTS. The supported
  podcast languages are Catalan, English, Spanish, and French, matching the
  application locale registry.

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
  configuration concerns, but both the script and speech must use the current
  interface language unless a dedicated podcast-language setting is introduced.
- Do not persist a duplicate podcast language while the product contract is
  "follow the interface". Resolve and normalize `settings.language` when the
  generation starts so a language change does not require a backend restart.
- Do not assume Catalan when the stored language is empty or invalid: the
  central interface-language normalizer falls back to English. Reuse that
  normalizer so podcast behavior stays aligned with the rest of Gnosi.
- Do not rely on a short language label when the source material and task
  instructions use another language. Repeat an explicit translate-and-output
  requirement in both system and user messages so the selected model cannot
  infer the source language as the desired output language.
- Do not write TTS output directly over the published MP3. Generate a `.part`
  file and replace the public file atomically only after successful, non-empty
  synthesis; otherwise restarts expose truncated audio as a finished episode.
- Do not synthesize a long episode through hundreds of strictly serial network
  calls. Use small bounded concurrency for independent sentences, preserve
  result ordering, and keep each request isolated so one failure does not
  corrupt the remaining audio.
- Tests that replace `load_params` must import `agent.factory` first because the
  factory still resolves its internal base directory from configuration at
  module import time. Replacing configuration before that import produces a
  test-only incomplete `Config` object failure unrelated to podcast routing.
- Preserve the existing article filtering, batching, prompts, MP3 naming,
  manual endpoint, scheduler task, and generation lock.
- Do not generate audio in the runtime `paths.AUDIO` directory while the Reader
  serves files from the active vault: this makes successful generations
  invisible to the UI. Generation, metadata, and streaming must share the
  active vault's `data/podcasts` directory.
- Capture and restore the active-vault context inside the background generation
  thread. Context variables do not propagate automatically to new threads.

## Verification

1. Unit-test default and explicit route resolution, disabled-route rejection,
   language normalization, LangChain invocation, gTTS language selection, and
   usage recording.
2. Test the Settings model-option normalization and persisted unavailable route.
3. Run backend targeted tests and frontend unit tests.
4. Run the frontend production build.
5. Verify Settings visually and through the DOM in a browser, then exercise the
   configuration API round trip and the podcast generation path with a mocked
   model to avoid paid external calls.
