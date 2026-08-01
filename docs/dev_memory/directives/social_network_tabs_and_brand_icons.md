# DIRECTIVE: Social-network tabs and brand icons

> ID: 2026-08-01-social-tabs
> Status: ACTIVE

## Objective and scope

Replace the emoji-based social-network controls in Gnosi settings with compact,
accessible tabs using local vector renderings of the corresponding brand marks.
The same renderer must be usable wherever a stream identifies a known network,
without altering the persisted social-network or stream schema.

## Logical flow

1. Maintain a single frontend mapping from a social-network identifier to its
   vector icon and accessible label.
2. Render the configured networks as a responsive tab list, keeping the
   existing enable/disable action and its optimistic persistence behavior.
3. Use the mapping for known stream networks, while preserving a safe fallback
   for custom or scheduled streams whose stored icon is user-defined.
4. Verify that keyboard users can focus and operate every network control and
   that mobile widths wrap without clipping.

## Restrictions and edge cases

- Do not add remote image URLs: settings must render while offline and must not
  expose a user's network configuration to third parties.
- Do not replace or migrate saved `icon` values in backend data; the `network`
  identifier is authoritative only for known brand rendering.
- Do not use emoji as the visual for Mastodon, Bluesky, LinkedIn, Facebook, or
  Telegram; use the shared local SVG renderer instead.
- Do not treat the tabs as navigation unless a distinct per-network panel is
  implemented. They remain accessible enable/disable controls.
- Do not hard-code new user-visible UI text; existing localized network names
  and labels remain the source of copy.
- Reloading the application closes the settings modal. Reopen the Social
  section before asserting persisted network state after a reload.

## Verification gates

- Run the frontend production build with no errors.
- Inspect the Social settings panel in the native frontend and confirm five
  branded network tabs are visible and toggling one persists after reload.
- Confirm an existing stream still displays a fallback icon when its network is
  unknown or scheduled.

## Error protocol and learning

| Date | Error detected | Root cause | Solution |
| --- | --- | --- | --- |
| 2026-08-01 | Not yet observed | N/A | Add any implementation failure and its prevention rule here before retrying. |
