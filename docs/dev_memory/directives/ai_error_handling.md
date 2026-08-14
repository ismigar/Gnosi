# Directive: AI errors, fallback, and timeouts

## Error handling

1. Catch provider and LangChain exceptions in backend agent routes.
2. Stream an `error` event with a localized, actionable message.
3. If primary-provider construction fails, try the next configured provider
   that has usable credentials.

`AgentChat.jsx` must render a clear error without leaving an empty assistant
bubble. Do not retry the same rate-limited provider/model as fallback.

## Real one-shot timeouts

Passing `config={"timeout": N}` to `llm.invoke` does not impose a timeout;
`timeout` is not a `RunnableConfig` key and LangChain silently ignores it. A
hung provider can therefore occupy a worker indefinitely and eventually
exhaust the native backend's `asyncio.to_thread` pool.

Set the timeout when constructing the client in `get_llm`:

- OpenAI-compatible providers:
  `ChatOpenAI(timeout=N, max_retries=0)`.
- Ollama: `ChatOllama(client_kwargs={"timeout": N})`. Direct
  `ChatOllama(timeout=N)` is ignored by its permissive model config.
- Anthropic: `ChatAnthropic(timeout=N, max_retries=0)`.

Use `max_retries=0` for the one-shot path. OpenAI SDK retries are
per-attempt, so default retries can multiply the effective maximum. The
streaming agent path does not pass a one-shot timeout and retains its normal
retry behavior.

HTTPX timeouts apply per connect, read, and write operation rather than as a
total wall-clock deadline. This is sufficient for the main failure mode of a
provider that stops returning bytes.

Timeout exceptions are provider-specific, not `RuntimeError`. Existing
callers catch `Exception` and degrade to raw text, placeholders, or an error
ToolMessage. Reserve `RuntimeError` for no available provider. Map timeouts in
`/ai/generate` and `/ai/correct` to HTTP 504.

## Restrictions

- Never rely on `config={"timeout": ...}` at invocation time.
- Do not implement a provider-agnostic `ThreadPoolExecutor` timeout. It leaves
  the underlying HTTP thread and connection running after the future times
  out. Client-level timeouts abort the request and release resources.
- Distinguish the locally enforced whole-turn `TimeoutError` from a provider
  timeout. Do not record it as provider reliability evidence and do not collapse
  its empty exception text into a generic error. Stream the stable
  `agent_turn_timeout` code so every client locale can explain the 120-second
  processing limit.
