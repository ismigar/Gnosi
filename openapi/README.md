# OpenAPI contract

`openapi.json` is the deterministic public HTTP contract generated from the
canonical FastAPI application. It is committed so frontend generation and API
review do not depend on a running backend.

From the repository root:

```bash
pnpm generate:api-client
pnpm check:api-client
```

Generation runs against an ephemeral Vault and data directory, disables
background scheduling and secure-store access, and must not write runtime or
configuration files into the checkout. Never edit `openapi.json` or the generated
TypeScript client by hand.

## Gnosi 2.x compatibility gate

`pnpm check:api-client` also proves that the current public surface preserves the
final 2.x contract. The canonical baseline is extracted from the repository's
real `v2.0.6` Git tag and committed at
`backend/tests/contracts/api-v2.0.6.json`. Its recorded commit and tree IDs are
verified on every run, and the checker reconstructs the inventory from those Git
objects so a hand-edited fixture cannot pass silently.

The inventory compares HTTP method and public path while keeping JSON,
streaming, download, redirect and WebSocket transports separate. Parameter names
are normalized because FastAPI omits path converters from OpenAPI; literal path
segments remain exact. WebSockets are extracted from source because OpenAPI does
not represent them.

Run the focused gate with:

```bash
pnpm check:api-compatibility
```

Baseline regeneration is exceptional and requires the complete historical tag
to be available locally. Never regenerate it from the current application or a
moving branch. From a clean worktree:

```bash
uv run python scripts/check_api_compatibility.py \
  --regenerate-baseline --source-ref v2.0.6
git diff -- backend/tests/contracts/api-v2.0.6.json
pnpm check:api-compatibility
```

Review every changed operation and verify the recorded commit/tree identity
before committing. Deliberate incompatibilities belong in
`backend/tests/contracts/api-compatibility-allowlist.json`; each entry must name
one exact operation, declare `removed` or `replaced`, and contain a concrete
reason. Wildcards, missing replacements and stale exceptions fail the check.
