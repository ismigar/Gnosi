# SKILL: Vault AI Assistant

This skill allows the AI agent (Antigravity/Alejabot) to act as a co-pilot for the Gnosi Vault, performing contextual analysis and operations on Notion pages and databases.

> ID: VAULT-AI-20260401
> Associated Scripts: `monorepo/apps/gnosi/pipeline/skills/vault_ai_assistant/scripts/`
> Status: ACTIVE

---

## 1. Technical Context

### Data Sources
1. **Local Registry**: `~/Library/CloudStorage/OneDrive-UNED/Gnosi/BD/vault_db_registry.json`. Contains the schema and IDs of all databases.
2. **Notion API**: Accessed via the `notion-server` MCP.

### Key Paths (from `paths_config.py`)
- `VAULT`: Root of the Gnosi ecosystem.
- `REGISTRY`: The `vault_db_registry.json` file.

---

## 2. Interaction Protocol (SOP)

### A. Context Acquisition
Before performing any operation in the Vault, the agent **MUST**:
1. Consult the `REGISTRY` to find the `database_id` corresponding to the table name (e.g., "Articles").
2. Validate that the requested properties match the schema defined in the registry.

### B. Content Creation
1. **Template Usage**: When creating records in "Articles" or "Tasks", respect the default properties (Status, Area, etc.).
2. **Naming**: Titles must be concise and descriptive.

### C. Analysis of Existing Information
1. Prioritize using `Query database` with filters to avoid saturating API limits.
2. Use `Retrieve block children` to read the actual page body before proposing edits.

---

## 3. Restrictions and Security
- **NO deletion without confirmation**: The agent can never delete a page or database without the user's explicit request.
- **Schema Integrity**: Never add properties to a database via the API without documenting the change in the registry first.
- **Privacy**: Do not export Vault content to external services without authorization.

---

## 4. History and Learning (Learning Cycle)

| Date | Error / Learning | Root Cause | Solution / Refinement |
| --- | --- | --- | --- |
| 2026-04-01 | Initial Setup | N/A | Definition of the integration protocol. |
| 2026-04-08 | Memory Consolidation | Fragmented protocol | Migration of the directive from `docs/` to the formal `Skill`. |

---

## 5. Pre-execution Checklist
- [ ] Validate access to the `vault_db_registry.json` file.
- [ ] Verify that the `notion-server` MCP is active.
- [ ] Confirm the specific Database ID before any write operation.
