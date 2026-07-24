# Directive: Restore AI configuration

## Context

Gnosi stores AI configuration in `params.yaml`. An empty agent list or missing
`active_agent_id` produces "No LLM provider available."

## Recovery

1. Locate the active `params.yaml`, normally in the configured data directory.
2. Inspect the `ai:` section.
3. Restore the default `gnosy` agent when `agents` is empty.
4. Select a provider and model supported by the current runtime.
5. Set `active_agent_id` to the restored agent ID.

## Restrictions

- If the provider value uses a `__keychain__:` reference, manage its API key
  through Gnosi's credential system, never directly in YAML.
- The restored agent must have `enabled: true`.

## Verification

- The backend creates the agent workflow without HTTP 503.
- Frontend chat displays the selected model correctly.
