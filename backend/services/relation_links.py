"""Relation wikilinks in the frontmatter — shared helpers.

Canonical format of a relation field item::

    "[[Title|<id>]]"

The value is EXACTLY a wikilink and the id lives in the alias. The title only
provides portability (Obsidian: navigation, graph, backlinks, and automatic
refresh on renames); the alias id ALWAYS wins. Obsidian doesn't recognize
wikilinks mixed with text in a property — that's why the value is the
whole wikilink. See docs/dev_memory/directives/relation_wikilinks_frontmatter.md.

Deliberately lightweight module (only re + typing): imported by vault_routes,
graph_service, and pipeline scripts without pulling in any dependency.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from typing import Any

# Whole value = a single wikilink with alias. The alias (id) has no imposed
# form (there are legacy ids that aren't uuids); it only excludes `|` and `]`.
RELATION_WIKILINK_RE = re.compile(
    r"^\s*\[\[(?P<title>[^\]\|]*?)\s*\|\s*(?P<rid>[^\]\|]+?)\s*\]\]\s*$"
)

# Wikilink without alias ([[Title]]): typical of a manual edit in Obsidian.
TITLE_ONLY_WIKILINK_RE = re.compile(r"^\s*\[\[\s*(?P<title>[^\]\|]+?)\s*\]\]\s*$")

# A title with these characters can't live inside a wikilink (it would break
# the wikilink parsing or resolution in Obsidian) → the id is left bare.
_UNSAFE_TITLE_RE = re.compile(r"[\[\]\|#^\r\n]")


def is_relation_key(key: Any, relation_keys: set[str] | None = None) -> bool:
    """A key is a relation key if it's in the schema's ``relation_keys`` set
    (names + aliases of the ``type=="relation"`` properties). Detection is
    always schema-based; field names don't carry any decorative prefix.
    See docs/dev_memory/directives/vault_relation_inverse_sync.md"""
    return isinstance(key, str) and relation_keys is not None and key in relation_keys


def relation_keys_from_table(table: dict[str, Any] | None) -> set[str]:
    """Names (and aliases) of the ``type=="relation"`` properties of a table in the
    registry. It's the (single) source of truth for knowing which fields are
    relation fields, whatever name they have after a rename."""
    keys: set[str] = set()
    if isinstance(table, dict):
        for p in table.get("properties") or []:
            if isinstance(p, dict) and p.get("type") == "relation":
                name = p.get("name")
                if isinstance(name, str) and name:
                    keys.add(name)
                for a in p.get("aliases") or []:
                    if isinstance(a, str) and a:
                        keys.add(a)
    return keys


def strip_item(value: Any) -> Any:
    """``[[Title|id]]`` → ``id``. Any other value, unchanged."""
    if isinstance(value, str):
        m = RELATION_WIKILINK_RE.match(value)
        if m:
            return m.group("rid")
    return value


def strip_relation_wikilinks(metadata: Any, relation_keys: set[str] | None = None) -> Any:
    """Frontmatter → domain: relation fields become clean ids again.

    This is the single READ boundary: from here on, the whole app (table,
    filters, graph, automations, syncs) sees ids, never wikilinks.
    ``relation_keys`` (from the schema) identifies which fields are relation fields; without
    a schema NOTHING is stripped, so as not to touch a wikilink that might live in a
    text field. Mutates and returns ``metadata``.

    """
    if not isinstance(metadata, dict):
        return metadata
    for key in metadata:
        if not is_relation_key(key, relation_keys):
            continue
        value = metadata[key]
        if isinstance(value, list):
            metadata[key] = [strip_item(v) for v in value]
        else:
            metadata[key] = strip_item(value)
    return metadata


def _decorate_item(
    value: Any,
    id_to_title: Callable[[str], str | None] | None,
    title_to_id: Callable[[str], str | None] | None,
) -> Any:
    if not isinstance(value, str) or not value.strip():
        return value

    decorated = RELATION_WIKILINK_RE.match(value)
    if decorated:
        rid = decorated.group("rid")
    else:
        title_only = TITLE_ONLY_WIKILINK_RE.match(value)
        if title_only:
            # Manual edit in Obsidian: canonicalize only if the title
            # resolves to EXACTLY ONE page; otherwise, keep it as is (never invent ids).
            rid = title_to_id(title_only.group("title")) if title_to_id else None
            if not rid:
                return value
        else:
            rid = value.strip()

    title = id_to_title(rid) if id_to_title else None
    safe = str(title or "").strip()
    if not safe or _UNSAFE_TITLE_RE.search(safe):
        # Without a reliable title: bare id if we came from an id; if the item was already a
        # decorated wikilink, keep it (don't lose the last good title).
        return value if decorated else rid
    return f"[[{safe}|{rid}]]"


def decorate_relation_wikilinks(
    metadata: Any,
    relation_keys: set[str] | None = None,
    id_to_title: Callable[[str], str | None] | None = None,
    title_to_id: Callable[[str], str | None] | None = None,
) -> Any:
    """Domain → frontmatter: ``id`` → ``[[Title|id]]`` in relation fields.

    ``relation_keys`` are the field names with ``type == "relation"`` in
    the table's schema: the single source of truth for knowing which fields to decorate.
    Idempotent and self-healing: every save re-resolves the CURRENT title. If the
    title doesn't resolve (cold index), it degrades to a bare id and never blocks
    the write. Mutates and returns ``metadata``.

    """
    if not isinstance(metadata, dict):
        return metadata
    keys = set(relation_keys or ())
    for key in metadata:
        if key not in keys:
            continue
        value = metadata[key]
        if isinstance(value, list):
            metadata[key] = [_decorate_item(v, id_to_title, title_to_id) for v in value]
        else:
            metadata[key] = _decorate_item(value, id_to_title, title_to_id)
    return metadata
