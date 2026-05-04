# Directive: Publishing Strategy (Gnosi Publisher)

This directive defines the publishing strategy and philosophy of the Gnosi project. The technical implementation is consolidated in the `publisher` Skill.

## Strategic Objective
Replace the dependency on n8n with a deterministic Python-based flow that guarantees content integrity through:
1. **Centralization**: The Vault (Notion/Markdown) is the single source of truth.
2. **Multi-language**: Mandatory publishing in Catalan, Spanish, and English.
3. **Omni-channel**: Automatic synchronization between the web (Drupal) and Social Media.

## Business Logic Workflow

### 1. Ingestion and Quality
The supervisor agent must validate that an article has the `Ready to Publish` status before activating any automated process.

### 2. Translation Layer
Translation is not just literal; it must maintain the state of metadata and Notion import IDs to ensure traceability between languages.

### 3. Synchronization and Distribution
Publishing to Drupal is prioritized as a "validation step." Once we have the public Drupal URL, social media distribution is activated to maximize reach.

---

## Related Files and Implementation
For technical details, database IDs, or CLI commands, refer to:
- [**Skill: Publisher**](file:///Users/ismaelgarciafernandez/Projectes/monorepo/apps/gnosi/pipeline/skills/publisher/SKILL.md)
- Synchronization Script: `sync_vault_to_drupal.py`
- Social Media Script: `broadcast_social.py`

---
*Note: This directive resides in docs/ to maintain the business vision. Technical details are kept near the code.*
