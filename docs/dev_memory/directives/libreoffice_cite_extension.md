# Directive: Gnosi Cite LibreOffice extension

## Objective

Provide a Mendeley-style citation manager inside LibreOffice Writer with the
same backend behavior as the Word add-in: search, style selection, tracked
insertion, bibliography, and context-aware batch reformatting.

Location: `monorepo/apps/gnosi/integrations/libreoffice-cite/`.

## Architecture

The `.oxt` contains a Python UNO protocol handler for `gnosicite:` and a
Writer menu with four commands:

| Command | URL | Action |
|---|---|---|
| Insert citation | `gnosicite:insertCitation` | Open search dialog |
| Insert bibliography | `gnosicite:insertBibliography` | Append bibliography |
| Refresh all | `gnosicite:refreshAll` | Batch-reformat with document context |
| Settings | `gnosicite:settings` | Configure backend URL |

Menu nodes render by name order. Inserting a command before the separator
requires renumbering later nodes in `Addons.xcu`.

The extension reuses the Word add-in health, search, citation, batch citation,
and bibliography endpoints.

## Package

- `gnosi_cite.py`: UNO handler, API client, document operations, and dialogs.
- `description.xml`: extension metadata and `com.gnosi.cite` identifier.
- `META-INF/manifest.xml`: package media types.
- `ProtocolHandler.xcu`: `gnosicite:*` registration.
- `Addons.xcu`: Writer menu.
- `build.sh`: produces `gnosi-cite.oxt`.

## Implementation constraints

- Use Python standard-library `urllib`, `json`, and `uuid`; LibreOffice's
  embedded Python does not include `requests`.
- Declare `LibreOffice-minimal-version` in the LibreOffice 2011 namespace.
  Do not use `OpenOffice.org-minimal-version` for LibreOffice 5+, because
  OpenOffice never reached that version and the dependency remains
  unsatisfied.
- The HandlerSet node name must exactly match the Python implementation name.
- Declare Python as
  `application/vnd.sun.star.uno-component;type=Python` and `.xcu` files as
  configuration data. Do not list `description.xml` in the package manifest.
- Track citations with `com.sun.star.text.ReferenceMark` names of
  `gnosicite::<key>::<uuid>`. Insert text first, then absorb the range into the
  mark.
- Determine citation order by traversing text portions and table cells. The
  reference-mark collection is name-ordered and unsuitable for APA
  disambiguation.
- Include nested tables up to `MAX_TABLE_NESTING`. Exclude headers and footers
  intentionally because repeated page content has no unique reading position.
- Use internal paragraph style names such as `Heading 1` and `Standard`, not
  localized display names.
- UNO ListBox double-click can emit an empty `ActionCommand`; treat it as the
  selection action.

## Build and installation

Validate Python compilation, every XML/XCU file, and the package contents.

On macOS, prefer **Tools > Extension Manager > Add**. CLI `unopkg add` can
report a named-pipe connection error after placing files in cache. For a new
installation the package can still register at the next GUI start, but
`add --force` over the same version can silently retain the old payload.

Reliable CLI reinstall:

1. Quit LibreOffice completely.
2. `unopkg remove com.gnosi.cite`.
3. Install the new package as a clean add.
4. Compare deployed `gnosi_cite.py` bytes or hash with the source.
5. Start LibreOffice in GUI mode.

`unopkg list` must show `is registered: yes` for the package components. A
listed cache directory alone does not prove the menu registered.

## User configuration

Store `{backend_url, style, locale}` under
`~/.config/gnosi-cite/config.json`. Default backend:
`http://localhost:5002`.

## Backend correctness traps

- Resolve CSL files in both native and Docker layouts. If `--csl` is omitted,
  Pandoc silently uses its default style and APA, MLA, and Chicago can look
  identical.
- Keep backend CSL mapping equivalent to frontend `recursosPageToCsl`,
  including structured authorship. Test both sides together.
- Citation keys are CSL item IDs and must be non-empty and unique. Rebuild
  them with the idempotent maintenance tool when required.
- Editing a citation key must invalidate the lookup index immediately; page
  count is not a sufficient cache key.
- Never delete `local_data/cache/vault_page_index_*.json` as a refresh
  mechanism. It forces a full OneDrive rescan and leaves citation search empty
  for minutes. Write changes through the API and allow normal invalidation.

## QA

- Install through Extension Manager and restart Writer.
- Confirm the Gnosi Cite menu and all four commands.
- Compare formatted output against expected APA, not merely HTTP 200.
- Verify repeated authors/years and citations inside nested tables.

See the integration README for current user-facing installation and
troubleshooting instructions.
