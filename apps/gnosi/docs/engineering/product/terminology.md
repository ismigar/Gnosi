---
status: implemented
last_verified: 2026-08-02
source_paths:
  - backend/models/management.py
  - backend/config/app_config.py
  - backend/services/context_vars.py
  - backend/services/workspace_service.py
tests: []
---

# Terminology

| Term | Engineering meaning |
| --- | --- |
| Vault | A directory whose Markdown files and assets form one knowledge space. |
| Page | A Markdown document with YAML front matter and a stable `id`. |
| Database or table | A structured view over pages, normally scoped to a folder and schema rather than a separate SQL table. |
| View | A saved projection of a database: type, filters, sort, grouping, fields, and layout state. |
| Registry | Gnosi-managed metadata describing databases, views, schemas, or catalogs. |
| Sidecar metadata | Internal `.gnosi` data associated with content but intentionally separated from user-authored Markdown fields. |
| Management database | Local-only SQLite state for identities, workspaces, memberships, vault access, tokens, and share links. |
| Local data | Per-instance databases, caches, indexes, secrets, logs, outputs, and checkpoints. It must not be cloud-synchronized. |
| Personal mode | Default single-user mode with authentication bypassed unless explicitly required. |
| Organization mode | Authenticated mode with workspace membership and ordered roles. |
| Workspace | Administrative boundary that groups members and registered vaults. |
| Runtime skill | A documented application capability under `pipeline/skills/`; not a development-agent plugin. |
| Tool | A callable operation available to an agent, possibly discovered through MCP or generated locally. |
| MCP | Model Context Protocol, used to discover and invoke external agent tools. |
| Directive | Engineering memory describing a procedure, decision, incident, restriction, or implementation plan. |
| Generated reference | Deterministic documentation derived from current source without importing the runtime. |
| Source of truth | Data whose loss cannot be repaired from another authoritative representation. |
| Derived data | Cache or index that can be rebuilt from a source of truth. |
| File provider | Adapter for local or cloud-backed filesystem behavior such as hydration and availability checks. |
| Translation server | Zotero sidecar that translates web pages and identifiers into normalized reference metadata. |
| PAT | Personal Access Token; the management database stores only its hash and display prefix. |

## Naming boundary

Historical identifiers such as `vault`, `DIGITAL_BRAIN_VAULT_PATH`, and some
legacy Temenos-prefixed integration keys remain compatibility contracts. Public
product language uses Gnosi and Knowledge where migrations have completed.
Identifiers are not renamed merely to make documentation terminology uniform.
