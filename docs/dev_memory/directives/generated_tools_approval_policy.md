# Generated Tool Approval Policy

> Decision: every generated tool requires human approval before execution.

## Objective

Prevent LLM-generated Python influenced by untrusted vault, mail, PDF, or MCP
content from executing automatically.

## Rationale

The static validator is a tripwire, not a complete sandbox:

- Allowed libraries can still read, write, or delete files.
- The loader executes Python dynamically.
- Previous risk classification depended on controllable name and description
  keywords.

No static heuristic can safely authorize arbitrary generated code. The reliable
boundary is human review before execution.

## Policy

- `needs_approval` is always true.
- Every new tool enters `pending/`.
- Calculated risk level is informational only.
- An administrator reviews the source and approves through the existing tools
  dashboard.
- Approval moves the tool into the active set and refreshes the loader.

## Restrictions

- Never reconnect auto-approval to name, description, inferred risk, or an LLM
  confidence score.
- Risk labels prioritize review; they do not grant permission.
- If automation is reconsidered, first add a real process sandbox or expose
  only a narrow capability API.
- Validator hardening and path containment remain defense in depth, not a
  replacement for approval.
- Approval UI and developer logs use English defaults and i18n where visible.

## QA

Generate tools at every risk level and verify all remain pending until an
authorized administrator approves them. Confirm rejected tools never load and
non-administrators cannot approve.
