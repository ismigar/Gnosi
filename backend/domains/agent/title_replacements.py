"""Exact human title substitutions over one server-resolved active view."""
from __future__ import annotations

import json
import hashlib
import re
from typing import Any

from backend.domains.agent.title_wording import scoped_title_operands
from backend.domains.agent.title_edit_contract import TitleEdit, state_title_edit

_QUOTE = r'(?:"[^"\n]*"|«[^»\n]*»|“[^”\n]*”|\x27[^\x27\n]*\x27)'
_JOIN = r'(?:i|y|and|et|,)'
_GROUP = re.compile(
    rf'(?P<sources>{_QUOTE}(?:\s*{_JOIN}\s*{_QUOTE})*)\s+'
    rf'(?:per|por|to|with|par|à)\s+(?P<target>{_QUOTE})', re.I,
)
_HEADERS = (
    r'(?:als|en els)\s+títols\s+(?:modifica|canvia|substitueix)\s+',
    r'(?:en los|a los)\s+títulos\s+(?:modifica|cambia|reemplaza)\s+',
    r'in the titles\s+(?:change|replace)\s+',
    r'dans les titres\s+(?:modifie|remplace)\s+',
    r'(?:modifica|canvia|substitueix)\s+(?:als\s+)?títols\s*:\s*',
    r'a tots els registres de la vista activa,\s*al títol\s+(?:canvia|substitueix)\s+',
    r'a todos los registros de la vista activa,\s*en el título\s+(?:cambia|reemplaza)\s+',
    r'for all records in the active view,\s*change the title from\s+',
    r'pour toutes les lignes de la vue active,\s*modifie le titre de\s+',
)
_NAMED_HEADERS = (
    r'(?:als|en els)\s+títols\s+de\s+@(?P<target>[^\n@]{1,256})\s+(?:modifica|canvia|substitueix)\s+',
    r'(?:en los|a los)\s+títulos\s+de\s+@(?P<target>[^\n@]{1,256})\s+(?:modifica|cambia|reemplaza)\s+',
    r'in the titles\s+(?:of|in)\s+@(?P<target>[^\n@]{1,256})\s+(?:change|replace)\s+',
    r'dans les titres\s+de\s+@(?P<target>[^\n@]{1,256})\s+(?:modifie|remplace)\s+',
)


def _title_header(text: str) -> re.Match[str] | None:
    return next((match for pattern in (*_HEADERS, *_NAMED_HEADERS)
                 if (match := re.match(pattern, text, re.I))), None)


def title_replacements(message: str) -> list[tuple[str, str]] | None:
    """Recognize a complete request, never quoted or explanatory instructions.

    Unsupported wording uses normal planning. This fast path accepts only
    explicit quoted operands and connectors; suffix actions or denials fail.
    """
    text = message.strip()
    header = _title_header(text)
    operands = text[header.end():] if header else scoped_title_operands(text)
    if operands is None:
        return None
    tail = operands.strip().removesuffix('.').rstrip()
    pairs: list[tuple[str, str]] = []
    end = 0
    for match in _GROUP.finditer(tail):
        gap = tail[end:match.start()]
        if (not pairs and gap.strip()) or (pairs and not re.fullmatch(rf'\s*{_JOIN}\s*', gap, re.I)):
            return None
        target = match['target'][1:-1]
        for quoted in re.findall(_QUOTE, match['sources']):
            source = quoted[1:-1]
            if not source or len(source) > 80 or len(target) > 80:
                return None
            pairs.append((source, target))
        end = match.end()
    if not pairs or tail[end:].strip() or len(pairs) > 8:
        return None
    if len({source for source, _ in pairs}) != len(pairs):
        return None
    return pairs


def title_target(message: str) -> str:
    """A mention label is an opaque scope, not an operand or an instruction."""
    header = _title_header(message.strip())
    return str(header.groupdict().get('target') or '').strip() if header and title_replacements(message) else ''


def active_title_scope(refs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Narrow to the unique active view; unrelated permanent sources grant none."""
    selected = {(str(ref.get('ref') or ''), str((ref.get('scope') or {}).get('view_id') or ''),
                 str((ref.get('scope') or {}).get('page_id') or '')): ref
                for ref in refs if ref.get('type') == 'table' and (ref.get('scope') or {}).get('view_id')}
    return list(selected.values()) if len(selected) == 1 else []


def title_view_revisions(refs: list[dict[str, Any]]) -> list[dict[str, str]]:
    """Bind an inventory and confirmation to the server's saved view filters."""
    from backend.domains.agent.context_storage import _table_view
    revisions = []
    for ref in refs:
        if ref.get("type") != "table" or not (ref.get("scope") or {}).get("view_id"):
            continue
        view = _table_view(ref["ref"], ref["scope"])
        if view is None:
            raise ValueError("context_view_unavailable")
        digest = hashlib.sha256(json.dumps(view, sort_keys=True, ensure_ascii=False, default=str).encode()).hexdigest()
        revisions.append({"table_id": ref["ref"], "view_id": str(view["id"]), "revision": digest,
                          **({"page_id": ref['scope']['page_id']} if ref['scope'].get('page_id') else {})})
    return revisions


def validate_title_view(scope: dict[str, Any]) -> None:
    refs = [{"type": "table", "ref": scope.get("table_id"), "scope": scope}]
    if not scope.get("view_id") or title_view_revisions(refs) != [scope]:
        raise ValueError("The active view changed after the title preview. Prepare it again.")


def title_view_label(scope: dict[str, Any]) -> str:
    from backend.domains.agent.context_storage import _table_view, _registry
    view = _table_view(scope["table_id"], {"view_id": scope["view_id"]}) or {}
    table: dict[str, Any] = next((table for table in _registry().get("tables", []) if table.get("id") == scope["table_id"]), {})
    return " · ".join(str(value) for value in (table.get("name"), view.get("name")) if value)


def current_title_instruction(messages: Any, state: Any, fallback: str) -> str:
    """Read the server-preserved human wording, keeping attachments as data."""
    original = str(state.get("user_request") or "")
    if title_replacements(original) is not None or state_title_edit(state, original):
        return original
    latest = next((message for message in reversed(messages) if getattr(message, "type", "") == "human"), None)
    visible = str((getattr(latest, "additional_kwargs", {}) or {}).get("gnosi_visible_content") or "")
    return visible if title_replacements(visible) is not None else fallback


def replace_title(title: str, pairs: list[tuple[str, str]]) -> str:
    """Replace simultaneously; single letters match tokens or numeric prefixes.

    F matches F1 and standalone F, while preserving Filosofia and existing Fase.
    Longer explicit strings retain literal substring semantics.
    """
    replacements = dict(pairs)
    patterns = [rf'(?<!\w){re.escape(source)}(?=\b|\d)'
                if len(source) == 1 and source.isalpha() else re.escape(source)
                for source in sorted(replacements, key=len, reverse=True)]
    return re.sub('|'.join(patterns), lambda match: replacements[match[0]], title)


def title_update_call(message: str, content: str, refs: list[dict[str, Any]], *, edit: TitleEdit | None = None) -> dict[str, Any] | None:
    """Prepare every changed title from a complete, literal, scoped inventory."""
    pairs = title_replacements(message)
    if pairs is None and edit is None:
        return None
    scope = active_title_scope(refs)
    if not scope:
        raise ValueError('title_replacement_scope_required')
    data = json.loads(content)
    expected_views = data.get("view_revisions")
    if not expected_views or expected_views != title_view_revisions(scope):
        raise ValueError("title_replacement_view_changed")
    rows = data.get('records') or []
    if (data.get('error') or data.get('has_more') or data.get('offset', 0)
            or data.get('query') or data.get('property_filters')
            or not data.get('snapshot_revision') or data.get('matching_count') != len(rows)
            or len(rows) > 100):
        raise ValueError('title_replacement_inventory_incomplete')
    updates, seen = [], set()
    for row in rows:
        identifier, title = row.get('id'), row.get('title')
        if (not isinstance(identifier, str) or not identifier or identifier in seen
                or not isinstance(title, str) or row.get('record_type', {}).get('id') != scope[0]['ref']
                or row.get('source_id') != scope[0]['id']):
            raise ValueError('title_replacement_inventory_invalid')
        seen.add(identifier)
        changed = edit.apply(title) if edit else replace_title(title, pairs or [])
        if changed != title:
            updates.append({'id': identifier, 'expected_title': title, 'properties': {'title': changed}})
    return {'name': 'bulk_update_rows', 'args': {'updates': updates, 'view_scope': expected_views[0]}, 'id': 'exact-title-replacement', 'type': 'tool_call'}


def title_response(message: str, reason: str) -> str:
    from backend.domains.agent.responses import _response_language
    responses = {
        'interpretation': {
            'ca': 'No he preparat cap canvi perquè no he pogut validar la interpretació. Pots concretar el canvi amb un exemple de títol abans i després?',
            'es': 'No he preparado cambios porque no he podido validar la interpretación. ¿Puedes concretar el cambio con un ejemplo de título antes y después?',
            'en': 'No changes prepared because I could not validate the interpretation. Can you give an example of a title before and after the change?',
            'fr': 'Aucune modification préparée : je n’ai pas pu valider l’interprétation. Pouvez-vous donner un exemple de titre avant et après le changement ?',
        },
        'scope': {
            'ca': 'Selecciona una vista concreta de la taula per preparar la substitució dels títols.',
            'es': 'Selecciona una vista concreta de la tabla para preparar la sustitución de los títulos.',
            'en': 'Select a specific table view to prepare the title replacements.',
            'fr': 'Sélectionnez une vue précise du tableau pour préparer le remplacement des titres.',
        },
        'inventory': {
            'ca': 'No he preparat canvis: no he pogut validar totes les files de la vista. Torna-ho a provar amb una vista de fins a 100 registres.',
            'es': 'No he preparado cambios: no he podido validar todas las filas de la vista. Vuelve a intentarlo con una vista de hasta 100 registros.',
            'en': 'No changes prepared: I could not validate every row in the view. Try a view with at most 100 records.',
            'fr': 'Aucune modification préparée : je n’ai pas pu valider toutes les lignes de la vue. Essayez une vue de 100 entrées au maximum.',
        },
        'unchanged': {
            'ca': 'Cap títol de la vista necessita aquesta substitució.',
            'es': 'Ningún título de la vista necesita esta sustitución.',
            'en': 'No title in the view needs these replacements.',
            'fr': 'Aucun titre de la vue ne nécessite ce remplacement.',
        },
        'failed': {
            'ca': 'No s’han pogut preparar els canvis: l’eina d’edició ha retornat un error. Revisa el detall abans de tornar-ho a provar.',
            'es': 'No se han podido preparar los cambios: la herramienta de edición ha devuelto un error. Revisa el detalle antes de volver a intentarlo.',
            'en': 'Changes could not be prepared: the editing tool returned an error. Review the details before trying again.',
            'fr': 'Les modifications n’ont pas pu être préparées : l’outil a renvoyé une erreur. Consultez le détail avant de réessayer.',
        },
    }
    language = ("ca" if re.search(r"\btítols?\b", message, re.I) else
                "es" if re.search(r"\btítulos?\b", message, re.I) else
                "fr" if re.search(r"\btitres?\b", message, re.I) else _response_language(message))
    return responses[reason][language]


def title_inventory_arguments(message: str, refs: list[dict[str, Any]], tool_names: Any, *, edit: TitleEdit | None = None) -> dict[str, Any] | None:
    if (title_replacements(message) is not None or edit) and active_title_scope(refs) and "inventory_context" in tool_names:
        return {"query": "", "include_relations": False, "limit": 100}
    return None


def title_brain_result(nodes: Any, turn: Any, progress: Any) -> dict[str, Any] | None:
    """Use only deterministic tool evidence; never retry a failed mutation."""
    from langchain_core.messages import AIMessage
    from backend.domains.agent.context import _latest_tool_message_since_latest_user
    edit = state_title_edit(turn.state, turn.latest_user)
    if (title_replacements(turn.latest_user) is None and edit is None) or "bulk_update_rows" not in turn.authorized_names:
        return None
    def final(reason: str) -> dict[str, Any]:
        result: dict[str, Any] = nodes._verified_final(turn, title_response(turn.latest_user, reason))
        result["messages"][0].additional_kwargs["gnosi_title_action_outcome"] = reason
        return result
    if not active_title_scope(nodes.context_refs):
        return final("scope")
    if "bulk_update_rows" not in turn.bound_tool_names:
        raise PermissionError("agent_team_action_tool_required")
    if _latest_tool_message_since_latest_user(turn.messages, "bulk_update_rows") is not None:
        return final("failed")
    if progress.inventory_message is None:
        return None
    try:
        if edit and title_view_revisions(active_title_scope(nodes.context_refs)) != [turn.state['title_edit']['view_scope']]:
            return final('scope')
        call = title_update_call(turn.latest_user, str(progress.inventory_message.content), nodes.context_refs, edit=edit)
    except (ValueError, TypeError, KeyError):
        return final("inventory")
    if call is None:
        return None
    if not call["args"]["updates"]:
        return final("unchanged")
    return {"messages": [AIMessage(content="", tool_calls=[call])], "next": "supervisor"}
