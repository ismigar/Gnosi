# Directive: Drupal Payload Preparer with Tags

## Goal
Transform n8n JSON input into a Drupal JSON:API compatible payload.
Specifically, map distinct tag names (strings) from the content item to Drupal UUIDs using a lookup table provided in the first item of the input array.

## Input Data Structure
The input is an array of objects.
- **Item 0 (Lookup):** Contains a `tags` array with objects `{ id: "uuid", tid: number, name: "TagName" }`.
- **Item 1..N (Content):** Contains:
  - `page_id`: Notion Page ID (used for tracking).
  - `drupal_internal__type`: e.g., "node--article".
  - `payload_to_translate`: { title: ... } (Translated content often overrides this).
  - `html_body`: The content body in HTML.
  - `persistent_data`: Contains `tags` (Array of Strings) and `idioma`.

## Logic Steps
1. **Extract Metadata:** Separate the first item (Index 0) if it contains the `tags` lookup list.
2. **Build Lookup Map:** Create a dictionary/map `TagName -> TagUUID` for O(1) access.
3. **Iterate Content Items:** Starting from Index 1 (or filter items that have `page_id`).
4. **Construct Payload:**
   - **Type:** Use `drupal_internal__type` (e.g., `node--article`).
   - **Attributes:**
     - `title`: From `payload_to_translate.title`.
     - `body`: `{ value: item.json.html_body, format: 'full_html' }`.
     - `langcode`: Map `persistent_data.idioma` (e.g., 'CA' -> 'ca').
   - **Relationships:**
     - `field_tags`:
       - Iterate `persistent_data.tags`.
       - Find UUID in Lookup Map.
       - Construct: `{ type: "taxonomy_term--tags", id: "UUID" }`.
     - `field_image`:
       - Check `persistent_data.image`.
       - Construct: `{ data: { type: "file--file", id: "IMAGE_UUID", meta: { alt: "Alt Text" } } }`.
5. **Output:** Return clean JSON objects ready for the Drupal HTTP Request node.

## Constraints & Edge Cases
- **Missing Tags:** If a tag name is not found in the lookup, ignore and log a warning.
- **Empty Lookup:** If Item 0 has no tags, return payload without tags.
- **Language Mapping:** Ensure language codes match Drupal (captured in `langcode`).

## Output Format
```json
{
  "notion_id": "...",
  "drupal_internal_type": "...",
  "payload": {
    "type": "node--article",
    "attributes": {
        "title": "...",
        "body": {
        "value": "...",
        "format": "full_html"
        },
        "langcode": "ca"
    },
    "relationships": {
        "field_tags": {
        "data": [
            { "type": "taxonomy_term--tags", "id": "..." }
        ]
        }
    }
  }
}
```
