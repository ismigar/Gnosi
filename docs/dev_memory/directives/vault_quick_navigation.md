# Vault Quick Navigation

## Objective

Keep every vault quick-navigation surface consistent with the canonical page loader and prevent generated index pages from crowding out user-authored notes in the recent-pages view.

## Navigation Contract

- Quick-navigation components pass only the selected page ID to the page-selection callback.
- The callback's optional second argument is reserved for history navigation. Folder names must never be passed in that position because a non-empty folder is interpreted as `fromHistory`, which suppresses URL and history updates.
- Global Search, Recent Pages, and Tags use one shared selection helper so click and keyboard paths cannot diverge.

## Recent Pages Contract

- Calendar pages remain excluded.
- Sort user-authored notes by `last_modified` descending and show at most 20.
- Managed LLM Wiki indexes and legacy generated index pages do not compete with ordinary notes.
- If a vault contains only generated index pages, retain them as a fallback rather than showing an unexplained empty state.
- Recognize canonical generated-index metadata first. Legacy recognition requires both an index note type and an index-style title to avoid hiding ordinary user notes accidentally.

## Restrictions and Edge Cases

- Do not pass a folder as the second page-selection argument. It is treated as history state and leaves the browser URL at `/vault`; pass only the page ID.
- Do not exclude every note whose type is `index`. Users can create legitimate manual indexes; canonical management metadata or the stricter legacy title-and-type combination is required.
- Do not mutate the source note array while sorting. Modal props may be shared by multiple views; sort a copy.

## Validation

- Unit-test the callback arity and recent-note selection behavior.
- Run the focused frontend tests and the production frontend build.
- In the native app, use only the `Proves` vault and verify Global Search, Recent Pages, and Tags selections navigate to `/vault/page/<id>`.
