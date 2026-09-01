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
