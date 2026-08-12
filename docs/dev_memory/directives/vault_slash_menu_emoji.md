# Vault Slash Menu Emoji Picker

## Objective

Make the `/emoji` command open the same complete picker used by page icons and
insert emojis, Lucide icons, or custom uploaded icons at the current BlockNote
cursor position.

## Scope

- Vault page editor in `monorepo/apps/gnosi/frontend/src/components/Vault/`.
- The custom slash menu controller used by `BlockEditor`.
- The shared page `IconPicker`, including emoji, Lucide, and custom-icon tabs.
- A custom BlockNote inline-content type for non-text icons.

## Restrictions and edge cases

- Do not route `/emoji` through BlockNote's default emoji suggestion item. It
  dynamically imports `emoji-mart`, and a stale Vite optimized-dependency chunk
  leaves the grid loader open forever.
- Do not persist the slash query or the internal `:` trigger in page content.
- Preserve the ProseMirror selection while the picker has focus, then insert at
  that selection and return focus to the editor.
- Store Lucide and custom icons as encoded `{{gnosi-icon:...}}` Markdown tokens
  so they survive save and reload without exposing a raw URL in the editor.
- Keep Unicode emoji as normal text for interoperability with other Markdown
  editors.
- Keep all visible labels behind existing i18n keys.

## QA

1. Type `/emoji` in an empty paragraph and press Enter.
2. Confirm the full page-icon picker replaces the slash menu without a loading
   spinner and exposes Emoji, Icons, and Custom tabs.
3. Select one item from every tab and confirm each is inserted at the cursor.
4. Save and reload, then confirm Lucide and custom icons still render inline.
5. Confirm Escape and outside click close the picker without inserting content.
6. Run the frontend production build.
