# SKILL: Mark Notion Duplicates

**Description**: Identifies records in the Notion "Recursos" database that have duplicate titles (normalized) and marks them using the `Duplicat` checkbox property.

## 1. Logic
The script connects to the Notion API and performs the following:
1.  **Iterates** through all pages in the database.
2.  **Sanitizes** titles (lowercase, remove accents, trim).
3.  **Groups** pages by normalized title.
4.  **Checks** for the `Duplicat` property. If missing, it **automatically creates** it as a Checkbox.
5.  **Marks** *all* instances of a duplicate title as `True` in the `Duplicat` property.

## 2. Usage
Run via Python:
```bash
python monorepo/apps/digital-brain/pipeline/skills/mark_notion_duplicates/scripts/mark_duplicates.py
```

## 3. Environment Variables
Requires `.env_shared` (Notion Token) and local `.env` (Database ID).
-   `NOTION_TOKEN`: Integration token.
-   `DATABASE_ID`: Target Database ID.

## 4. Maintenance
-   **Rate Limits**: The script includes `time.sleep(0.4)` between updates to respect Notion's rate limits.
-   **Property Name**: The script looks for `Duplicat`. If not found, it tries to create it.
-   **Title Keys**: The script attempts to auto-detect the title property (e.g. "Nota", "Name", "Title").

## 5. Output
The script prints to stdout:
-   Database ID being queried.
-   Number of pages processed.
-   Duplicates found (title and count).
-   Pages updated.
