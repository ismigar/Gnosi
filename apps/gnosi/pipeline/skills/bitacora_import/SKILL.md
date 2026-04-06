# DIRECTIVE: IMPORT_BITACORA_NOTION

> ID: 2026-02-26
Associated Script: monorepo/apps/gnosi/pipeline/sandbox/import_bitacora.py
Last Update: 26/02/2026
Status: ACTIVE

---

## 1. Objectives and Scope

- **Main Objective:** Import the "Bitacora" database from Notion into the Digital Brain Vault.
- **Success Criteria:** 
    - Database entries are converted to Markdown files with YAML frontmatter.
    - Images are downloaded to the `Assets` folder and correctly referenced.
    - The output files are saved in the correct `Vault` directory used by the application backend.

## 2. Input/Output (I/O) Specifications

### Inputs

- **Required Arguments:**
    - `DATABASE_ID`: `1ef268e5-2714-8046-a7bc-dc6a5d555eb7`
- **Environment Variables (.env_shared):**
    - `NOTION_TOKEN`: Notion Integration Token.
    - `gnosi_VAULT_PATH`: Path to the local Vault.
- **Source Files:**
    - `monorepo/apps/gnosi/pipeline/skills/notion_migration/scripts/notion_to_markdown_global.py` (Reference script).

### Outputs

- **Generated Artifacts:**
    - Markdown files in `$gnosi_VAULT_PATH/Bitacora/`.
    - Downloadead assets in `$gnosi_VAULT_PATH/Assets/`.

## 3. Logical Flow (Algorithm)

1. **Initialization:** Load environment variables (`NOTION_TOKEN`, `gnosi_VAULT_PATH`).
2. **Setup:** Create destination directories if they don't exist (`Bitacora`, `Assets`).
3. **Fetching:** Query Notion Database using the provided ID.
4. **Iterative Processing:**
    - For each page:
        - Extract properties (title, dates, status, labels).
        - Fetch block children.
        - Parse blocks into Markdown (paragraphs, headings, lists, images).
        - **Asset Management:** If an image block is found, download the file locally and replace the URL with a relative path.
5. **Persistence:** Save the generated Markdown to the `Bitacora` folder using a sanitized title.
6. **Cleanup:** Ensure all connections are closed.

## 4. Tools and Libraries

- **Python libraries:** `requests`, `pyyaml`, `python-dotenv`, `pathlib`.
- **External APIs:** Notion API (v2022-06-28).

## 5. Restrictions and Edge Cases

- **Rate Limiting:** Provide a small delay (`0.35s`) between page requests to avoid Notion API throttling.
- **Image URLs:** Notion's internal image URLs expire after one hour; images MUST be downloaded during the import process.
- **Sanitization:** Filenames must be sanitized to avoid issues with specialized OS characters.

## 6. Error Protocol and Learning (Live Memory)

| Date | Error Detected | Root Cause | Solution/Patch Applied |
| --- | --- | --- | --- |
| 26/02/2026 | Initial Plan | N/A | Using `notion_to_markdown_global.py` as a robust reference. |

## 7. Examples of Use

```bash
python monorepo/apps/gnosi/pipeline/sandbox/import_bitacora.py
```
