# Directive: Mark Notion Duplicates

**Goal**: Identify records in the "Recursos" database that have duplicate titles and mark them using the `Duplicat` checkbox property.

## 1. Context & Logic
We need to sanitize the Notion database by flagging duplicates. A "duplicate" is defined as a record having the same **normalized title** as another record.

**Normalization Rules:**
1.  **Lowercase**: Convert to lowercase.
2.  **Remove Accents**: Use NFD normalization to remove accents (e.g., 'á' -> 'a').
3.  **Trim**: Remove leading/trailing whitespace.
4.  **Ignore Special Chars**: Optionally remove special characters if strict matching is too sensitive (for now, we stick to standard text normalization).

**Action:**
-   If a Normalized Title appears **more than once**, ALL instances of that title are marked with `Duplicat = True`.
-   This allows the user to manually review the flagged items and decide which one to keep (e.g., based on content, tags, or creation date).

## 2. Dependencies
-   `notion-client`
-   `python-dotenv`
-   `unicodedata` (standard lib)

## 3. Environment Variables
-   `NOTION_TOKEN`: Integration token.
-   `DATABASE_ID`: ID of the "Recursos" database.

## 4. Script Structure (`pipeline/sandbox/mark_duplicates.py`)
1.  **Setup**: Load env, initialize Notion client.
2.  **Fetch**: Query the database to get **ALL** pages (handle pagination).
    -   Need `properties` to include the Title and the `Duplicat` checkbox.
3.  **Process**:
    -   Iterate through pages.
    -   Extract Title (handle aliases like "Name", "Title", "Títol", "Nota").
    -   Normalize Title.
    -   Store in a dictionary: `TitleHash -> [PageID, PageID, ...]`.
4.  **Identify**: Filter the dictionary for entries with `len(list) > 1`.
5.  **Update**:
    -   For each duplicate page, check if `Duplicat` is already True.
    -   If not, update the page property `Duplicat` to `True`.
    -   Log the update.

## 5. Constraints & Edge Cases
-   **Rate Limits**: Notion API has a rate limit of 3 requests/sec. Use `time.sleep()` if performing many updates.
-   **Missing Title**: Some pages might have an empty title. These should probably be ignored or grouped together as "Untitled".
-   **Property Name**: Ensure the checkbox property is exactly named `Duplicat`. If it doesn't exist, the script should fail or warn (or create it?? No, scripts shouldn't alter schema generally without permission).

## 6. Execution
Run via:
```bash
python monorepo/apps/digital-brain/pipeline/sandbox/mark_duplicates.py
```
