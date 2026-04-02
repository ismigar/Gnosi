# DIRECTIVE: VAULT_AI_ASSISTANT_INTEGRATION

> ID: VAULT-AI-20260401
> Associated Skill: monorepo/apps/gnosi/pipeline/skills/vault_ai_assistant
> Last Update: 2026-04-01
> Status: ACTIVE

---

## 1. Objectives and Scope

The goal is to enable the AI assistant (Antigravity/Alejabot) to act as a co-pilot for the Gnosi Vault, providing context-aware analysis and performing operations on pages and databases.

- **Main Objective:** Provide the assistant with a live map of the Vault's structure and allow it to manage content via the Notion API.
- **Success Criteria:** The assistant can identify available databases by their user-friendly names and perform CRUD operations without breaking existing schemas.

## 2. Technical Context

### Data Sources
1. **Local Registry:** `/Users/ismaelgarciafernandez/Library/CloudStorage/OneDrive-UNED/Gnosi/BD/vault_db_registry.json`. Contains the schema and IDs of all databases.
2. **Notion API:** Accessed via the `notion-server` MCP.

### Key Paths (from `paths_config.py`)
- `VAULT`: Root of the Gnosi ecosystem.
- `REGISTRY`: The `vault_db_registry.json` file.

## 3. Interaction Protocol (SOP)

### A. Context Acquisition
Before performing any operation in the Vault, the assistant **MUST**:
1. Read the `REGISTRY` to find the `database_id` corresponding to the requested table (e.g., "Articles").
2. Validate that the properties requested for an edit or creation match the schema defined in the registry.

### B. Content Creation (Pages/Records)
1. **Template Awareness:** When creating records in "Articles" or "Tasques", use the default properties defined in the registry (e.g., "Estat", "Àrea").
2. **Naming Convention:** Titles should be concise and relevant.

### C. Analysis of Existing Info
1. Use `Query database` with filters whenever possible to avoid large payload limits.
2. Use `Retrieve block children` to read the actual body of a page before proposing edits.

## 4. Restrictions and Safety

- **NO DELETION without explicit confirmation:** The assistant must never delete a page or database unless the user specifically types "Elimina [nombre]".
- **Protect Schema Integrity:** Never add properties to a database via the API without documenting the change in the registry first.
- **Privacy:** Do not export Vault content to external services unless requested.

## 5. Error Protocol and Learning (Live Memory)

| Date | Error Detected | Root Cause | Solution/Patch Applied |
| --- | --- | --- | --- |
| 01/04/26 | Initial Setup | N/A | Definition of the integration protocol. |

---

## 6. Pre-Execution Checklist
- [ ] Check if `vault_db_registry.json` is accessible.
- [ ] Verify that the `notion-server` MCP is active.
- [ ] Confirm the specific Database ID before any write operation.
