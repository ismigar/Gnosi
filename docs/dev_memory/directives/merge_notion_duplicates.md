# Directive: Merge Notion Duplicates

**Goal**: Consolidate duplicate records in the Notion 'Recursos' database by merging properties from "secondary" records into the "primary" record, then archiving the secondary ones.

## Identification Logic

1.  **Grouping**: Records are grouped by their **Normalized Title** (lowercase, no accents, trimmed).
2.  **Primary Record (Target)**: The record whose `Zotero URI` starts with `zotero://`.
    *   *Tie-breaker*: If multiple have `zotero://`, pick the one with the most filled properties or the most recent (arbitrary stability: sort by ID or creation time).
    *   *Fallback*: If none have `zotero://`, pick the first one as target.
3.  **Secondary Record (Source)**: Any record in the group that is NOT the Primary.

## Merge Logic (The "Smart Merge")

For each Secondary record:
1.  Iterate through all its properties.
2.  **Condition for Merge**:
    *   The **Target** record has an EMPTY value for this property (None, empty string, empty list).
    *   The **Source** record has a NON-EMPTY value.
3.  **Action**: Update the **Target** record with the **Source**'s value.
4.  **Logging**: Log the specific property merged (e.g., "Merged 'Autor' from [ID-Source] to [ID-Target]").

## Archival Logic

1.  After **all** valid properties from a Secondary record have been merged into the Primary:
    *   **Archive** the Secondary record (`archived: True`).
    *   Do **NOT** permanently delete (allows recovery).

## Safety Constraints

*   **Dry Run**: The script should support a `--dry-run` flag to preview changes without applying them.
*   **Rate Limiting**: `time.sleep(0.4)` between writes.
*   **Environment**: Must load `NOTION_TOKEN` from `.env.shared` and prioritize `NOTION_DB_RECURS` (or `DATABASE_ID`).

## Known Limitations

*   **Relation/Rollup Properties**: Merging relations can be complex. For now, we will try to append/set them if the library allows simple ID lists. If it fails, log error and skip property.
*   **Rich Text**: We merge plain text or rich text objects.
