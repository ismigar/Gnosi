"""Resolve human title targets and the selected embedded view before planning."""
from __future__ import annotations

import re
import unicodedata
from typing import Any

from backend.domains.agent.context_refs import normalize_refs
from backend.domains.agent.title_replacements import active_title_scope, title_target


def _label(value: str) -> str:
    # UI labels may omit a final full stop and use typographic quotation marks.
    value = unicodedata.normalize('NFC', value).translate(str.maketrans('“”«»', '""""'))
    return re.sub(r'\s+', ' ', value).strip().rstrip('.').casefold()


def mention_context_refs(message: str, mentions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Only mentions still visible in this human turn attach a source."""
    return normalize_refs([{'id': f"mention:{mention['type']}:{mention['id']}",
                           'type': mention['type'], 'ref': mention['id'], 'label': mention['label']}
                          for mention in mentions if mention.get('type') in {'page', 'table', 'database'}
                          and mention.get('id') and mention.get('label')
                          and f"@{mention['label']}" in message])


def _named_page(target: str, refs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    selected = [ref for ref in refs if ref.get('type') == 'page' and _label(ref.get('label', '')) == _label(target)]
    if selected:
        return normalize_refs(selected)
    from backend.domains.vault.links.runtime import build_id_title_index
    matches = [(identifier, title) for identifier, title in build_id_title_index().items() if _label(title) == _label(target)]
    if len(matches) != 1:
        return []
    identifier, title = matches[0]
    # Revalidate the cached name against this exact page, never a fuzzy search.
    from backend.domains.agent.gnosi_support import _resolve_page, _parse
    path = _resolve_page(identifier)
    if path is None or _label(str(_parse(path)[0].get('title') or '')) != _label(target):
        return []
    return [{'id': f'mention:page:{identifier}', 'type': 'page', 'ref': identifier, 'label': title}]


def title_context_refs(message: str, refs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """An explicit target cannot fall back to an unrelated active table."""
    target = title_target(message)
    if not target:
        return refs
    from backend.domains.agent.context_storage import page_view_ids, expand_dashboard_context_refs
    pages = _named_page(target, refs)
    if len(pages) != 1:
        return []
    view_ids = page_view_ids(pages[0]['ref'])
    selected = active_title_scope([ref for ref in refs if ref.get('type') == 'table'
                                   and (ref.get('scope') or {}).get('view_id') in view_ids])
    selected = [{**ref, 'scope': {**ref['scope'], 'page_id': pages[0]['ref']}} for ref in selected]
    # Preserve an explicitly focused embed among multiple page-owned views.
    return [*selected, *pages] if selected else expand_dashboard_context_refs(pages)
