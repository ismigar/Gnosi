# Autonomous Bug-Hunt Findings

> Audit session: 2026-05-01, approximately 00:48–07:30. This historical note
> records completed fixes and remaining review themes.

## Summary

- 43 commits across 14 autonomous iterations.
- More than 52 confirmed defects fixed.
- Covered security, crashes, broken paths, case sensitivity, race conditions,
  blocking I/O, non-atomic writes, and missing error handling.
- Backend stayed healthy and scheduled tasks continued running.
- Frontend production builds passed.
- Lint errors dropped from 267 to 253; most remaining findings were cosmetic
  unused-variable issues.

## High-impact fixes

### Security and privacy

- Escaped email body content before `dangerouslySetInnerHTML` to prevent XSS.
- Validated Google OAuth `state` against pending authorization attempts.
- Stopped returning raw exception strings containing paths, SQL fragments, or
  tokens to API clients; responses now include a local log correlation ID.
- Corrected credential migration key matching and CORS configuration.

### Concurrency and durability

- Replaced direct JSON/YAML writes with atomic helpers in identity, scheduler,
  environment, configuration, Zotero, and integration state.
- Added locks around integration credentials, mail metadata, management
  engine initialization, rule evaluation state, and long-running audio
  generation.
- Corrected virtual-field cache invalidation after graph refresh.

### Async backend behavior

- Moved blocking LLM, HTTP, IMAP, SMTP, filesystem dialog, graph, and OAuth
  work off the FastAPI event loop with `asyncio.to_thread()`.
- Replaced deprecated event-loop access patterns.
- Preserved explicit `HTTPException` instances instead of swallowing them in
  broad handlers.

### Functional correctness

- Unified generated-tool creation and approval paths with
  `cfg.paths.AGENT_TOOLS`.
- Corrected podcast file lookup, calendar year fallback, reader and vault file
  path handling, and case-sensitive route behavior.
- Added explicit failure handling to vault cell saves, PDF uploads, and mail
  draft autosave.
- Fixed conditional hook usage in `useMailTags`.
- Corrected runtime state ownership in `BlockEditor`.

## Representative commits

| Commit | Area | Result |
|---|---|---|
| `5e32bbf8f` | Mail tags | Removed a conditional hook call. |
| `50782350b` | AI and integrations | Offloaded blocking calls from async endpoints. |
| `89307110c` | Identity and scheduler | Added atomic persistence and useful logging. |
| `9e52b77cd` | Tools and integration state | Fixed path divergence and concurrent writes. |
| `dfb2331da` | Graph, rules, audio | Corrected cache and race conditions. |
| `a656d0b23` | Server errors and CORS | Removed information leaks and invalid CORS behavior. |
| `c5ac926d5` | OAuth and credentials | Closed OAuth CSRF and migration failures. |
| `41c45272e` | File dialogs and uploads | Prevented event-loop stalls and broken links. |
| `1b5011092` | Mail viewer | Prevented HTML injection from email content. |

## Remaining review themes

### Broad exception handlers

Search `except Exception` blocks that cover explicit `HTTPException` raises.
The required pattern is:

```python
except HTTPException:
    raise
except Exception as exc:
    ...
```

### Non-atomic persistence

Search for direct `json.dump(..., open(..., "w"))` and similar writes. Use
`safe_write_json` or the appropriate atomic helper for every mutable state
file.

### Blocking work in async endpoints

Review each `async def` for `requests`, `time.sleep`, IMAP, SMTP, subprocess,
large filesystem walks, and CPU-heavy graph work. Move blocking calls to a
worker thread or convert them to a truly asynchronous implementation.

### Formula evaluator

The formula evaluator's use of JavaScript `Function` is a product and security
decision, not a safe automatic refactor. It requires an explicit sandboxing
design.

### Dead code and marginal edge cases

Remove dead paths only after proving they have no dynamic import, route, skill,
or configuration consumer. Preserve behavior when evidence is incomplete.

## Verification standard

Every audit fix requires:

1. A focused regression test.
2. Relevant backend or frontend tests.
3. A production frontend build when UI code changes.
4. Browser or API verification for user-visible behavior.
5. A documented restriction when a failure mode teaches a reusable rule.
