# Directive: Model reliability by failure reason

**Status:** Implemented as observability only. No automatic routing or
disablement uses these records.

## Problem

A hard-coded "bad with tools" model list becomes wrong as models change and
confuses account failures with model capability. During BOE QA, OpenRouter
returned HTTP 402 for insufficient credit; that is not evidence that the
selected model is bad at tool use.

## Principle

Attribute reliability evidence by failure reason:

| Reason | Owner | Meaning |
|---|---|---|
| `tool_use_failed` | model | emitted a tool call as text |
| `context_length_exceeded` | model | conversation exceeded its context |
| `schema_invalid` | model | violated the requested structure |
| `content_filter` | model | model-side policy blocked content |
| `rate_limit` | account | request quota exhausted |
| `insufficient_credit` | account | no credit, such as HTTP 402 |
| `auth` | account | credentials failed |
| `not_found` | account/provider | provider does not expose the model |
| `timeout` / `server_error` | provider | transient upstream failure |

`backend/agent/model_reliability.py` provides pure `classify_failure`,
ledger-backed `record_failure`, and `reliability_report(window_days)`. The
ledger groups `provider:model` by reason and day under
`cache/llm_failures.json`.

## Surfaces

- Chat shows a localized plain-language reason and repeated count when the
  model is responsible. Insufficient credit explicitly says it is not a model
  defect.
- Agent model selection and model registry show a warning only when
  `top_model_reason` identifies a model-attributable reason.
- API: `GET /api/ai/model-reliability?window_days=30`.

## Restrictions

- Keep this observational. Future routing may use only model-attributable
  reasons and only for the affected capability; `tool_use_failed` can remove
  tool capability without banning text generation.
- Protect the complete load-modify-save cycle with `_lock` and atomic writes.
  Concurrent failures must not overwrite counts.
- Reliability accounting must never fail the user request.
- Use a rolling 30-day window so repaired models recover.
- Keep provider in the key because the same model can have different tool
  behavior depending on who serves it.
