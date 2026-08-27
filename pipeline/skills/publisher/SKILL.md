# SKILL: Publisher

This skill handles the automation of the publishing flow from the Gnosi Vault to public channels (Drupal and Social Media).

> **Technical Source of Truth**: This skill completely replaces the legacy n8n workflows.

---

## 1. Data Mapping (Notion -> Drupal)
Crucial for the operation of synchronization scripts. If these UUIDs change in Notion, they must be updated here:

| Entity | Notion ID (UUID) | Target Drupal Table |
| :--- | :--- | :--- |
| **Articles** | `270268e5271480ca8b47fa9f28904287` | `articles` |
| **Designs** | `22e268e527148061bdf0cc752b016e70` | `designs` |
| **Resources** | `8c80f2a861b843b790da4f0e260b7db9` | `resources` |
| **Collaborators** | `245268e52714801ab698cfa44429c2cb` | `collaborators` |
| **XXSS** | `ebe282f0a2e145afbd76cd2036b37882` | `social_media` |

---

## 2. Core Features
- **Drupal Synchronization**: Converts Markdown files into Drupal nodes (Articles, Designs, Resources).
- **Translation Management**: Automatically generates versions in Catalan, Spanish, and English using OpenAI/DeepL via `sync_vault_to_drupal.py`.
- **Social Media Publishing**: Sends the title and content URL to LinkedIn, BlueSky, and Mastodon via `broadcast_social.py`.

---

## 3. Requirements and Configuration
- Access to **mcp-drupal-proxy** (Docker).
- Environment variables in `.env_shared`:
  - `DRUPAL_URL`, `OPENAI_API_KEY`, etc.
  - Social media tokens managed via Keychain.

---

## 4. Usage (CLI)

```bash
# Sync pending articles to Drupal
uv run python pipeline/skills/publisher/scripts/sync_vault_to_drupal.py --status "Ready to Publish"

# Publish a specific article to Social Media
uv run python pipeline/skills/publisher/scripts/broadcast_social.py --page-id "uuid-of-the-page"
```

---

## 5. Restrictions and Lessons Learned (Live Memory)
- **Drupal ID**: Never use the Notion UUID as the primary ID in Drupal (use the autoincremental node ID).
- **Format**: Clean Notion blocks before pushing to avoid rendering errors in Drupal.
- **Translations**: Do not publish if any mandatory languages (Catalan/Spanish) are missing.

---
*Maintenance: If the Drupal structure (fields) changes, the `map_markdown_to_drupal_fields` function in the scripts must be updated.*
