"""Fail-closed multilingual authorization intent."""

from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Optional, Sequence


def _mask_quoted_text(text: str) -> str:
    """Mask quoted/code spans so examples and copied instructions grant nothing."""
    patterns = (
        r"```.*?```",
        r"`[^`]*`",
        r'"[^"]*"',
        r"“[^”]*”",
        r"«[^»]*»",
        # Pair-delimited single quotes are examples/quotations too. The
        # surrounding-boundary checks preserve apostrophes inside words such
        # as Catalan ``l'esquema`` and French ``l'agent``.
        r"(?<![\wÀ-ÿ])'[^'\n]+'(?![\wÀ-ÿ])",
    )
    masked = text
    for pattern in patterns:
        masked = re.sub(
            pattern,
            lambda match: " " * len(match.group(0)),
            masked,
            flags=re.DOTALL,
        )
    return masked


def _affirmative_pattern_present(text: str, patterns: Sequence[str]) -> bool:
    """Match an action phrase only outside negation and meta capability queries."""
    meta_prefixes = (
        "analitza ",
        "analyse ",
        "analyze ",
        "explica ",
        "explain ",
        "explique ",
        "per què ",
        "por qué ",
        "why ",
        "què significa ",
        "qué significa ",
        "what does ",
    )
    third_person_queries = (
        "can this agent ",
        "can the agent ",
        "could this agent ",
        "pot aquest agent ",
        "pot l'agent ",
        "puede este agente ",
        "puede el agente ",
        "est-ce que cet agent ",
        "l'agent peut-il ",
    )
    masked = _mask_quoted_text(text)
    stripped = masked.strip()
    if stripped.startswith(meta_prefixes):
        return False
    if any(query in stripped for query in third_person_queries):
        return False

    negations = re.compile(
        r"\b(?:do not|don't|never|not|no|mai|nunca|jamais|sans|sense)\b"
        r"|\bne\b.*\bpas\b",
        re.IGNORECASE,
    )
    meta_context = re.compile(
        r"\b(?:"
        r"explain|describe|analy[sz]e|tell me|"
        r"how\s+(?:to|do|can|could|would|should)|"
        r"what\s+(?:happens|would happen)|whether|"
        r"can i|could i|may i|before\s+you|if\s+(?:you|i|we)|"
        r"documentation|docs?|phrase|example|"
        r"explica|analitza|com\s+(?:puc|podria|es pot|cal)|"
        r"què\s+passaria|abans\s+(?:que|de)|si\s+(?:tu|jo|et)|"
        r"documentació|frase|exemple|"
        r"analiza|cómo\s+(?:puedo|podría|se puede)|qué\s+pasaría|"
        r"puedo|podría|antes\s+de|si\s+(?:tú|yo|te)|"
        r"documentación|ejemplo|"
        r"explique|analyse|comment\s+(?:puis-je|peut-on|faire)|"
        r"que\s+se\s+passerait|puis-je|avant\s+de|"
        r"si\s+(?:tu|je|vous)|documentation|phrase|exemple"
        r")\b",
        re.IGNORECASE,
    )
    for pattern in patterns:
        start = 0
        while True:
            index = masked.find(pattern, start)
            if index < 0:
                break
            clause_start = (
                max(masked.rfind(separator, 0, index) for separator in (".", "!", "?", ";", "\n"))
                + 1
            )
            clause_end_candidates = [
                position
                for separator in (".", "!", "?", ";", "\n")
                if (position := masked.find(separator, index + len(pattern))) >= 0
            ]
            clause_end = min(clause_end_candidates, default=len(masked))
            clause = masked[clause_start:clause_end]
            prefix = masked[clause_start:index][-80:]
            # A denial anywhere in the same clause overrides an affirmative
            # phrase, including suffixes such as "but do not actually do it".
            if not negations.search(clause) and not meta_context.search(prefix):
                return True
            start = index + len(pattern)
    return False


def _matching_pattern_tools(
    text: str,
    patterns_by_tool: Mapping[str, Sequence[str]],
) -> set[str]:
    return {
        name
        for name, patterns in patterns_by_tool.items()
        if _affirmative_pattern_present(text, patterns)
    }


def _base_write_tools(
    text: str,
    cornell_actions: Sequence[str],
    page_patterns: Sequence[str],
    memory_patterns: Sequence[str],
) -> set[str]:
    authorized: set[str] = set()
    if "cornell" in text and _affirmative_pattern_present(text, cornell_actions):
        authorized.add("summarize_to_cornell")
    if "cornell" not in text and _affirmative_pattern_present(text, page_patterns):
        authorized.add("create_page")
    if _affirmative_pattern_present(text, memory_patterns):
        authorized.add("save_memory")
    if _reader_context_analysis_requested(text):
        authorized.add("start_reader_context_analysis")
    return authorized


def _mention_write_tools(
    text: str,
    mentions: Sequence[object],
) -> set[str]:
    mention_types = {
        str(mention.get("type", "") if isinstance(mention, dict) else getattr(mention, "type", ""))
        .strip()
        .lower()
        for mention in mentions
    }
    delete_verbs = (
        "elimina ",
        "esborra ",
        "delete ",
        "remove ",
        "supprime ",
        "borra ",
    )
    update_verbs = (
        "actualitza ",
        "edita ",
        "update ",
        "edit ",
        "modifie ",
    )
    authorized: set[str] = set()
    if {"table", "database"}.intersection(mention_types) and _affirmative_pattern_present(
        text, delete_verbs
    ):
        authorized.add("delete_table")
    if "page" in mention_types and _affirmative_pattern_present(text, delete_verbs):
        authorized.add("delete_page")
    if "page" in mention_types and _affirmative_pattern_present(text, update_verbs):
        authorized.add("update_page")
    return authorized


def _explicit_brain_write_tool_names(
    message: str,
    mentions: Optional[Sequence[object]] = None,
) -> set[str]:
    """Authorize fail-closed Brain mutations from the current human wording."""
    text = " ".join((message or "").strip().lower().split())
    if not text:
        return set()

    cornell_actions = (
        "crea",
        "crear",
        "fes",
        "prepara",
        "genera",
        "create",
        "make",
        "prepare",
        "generate",
        "summarize",
        "resume",
        "haz",
        "prepara",
        "genera",
        "résume",
        "crée",
        "prépare",
    )
    page_patterns = (
        "crea una pàgina",
        "crea una pagina",
        "crea una nota",
        "crear una pàgina",
        "crear una pagina",
        "crear una nota",
        "create a page",
        "create a note",
        "make a page",
        "make a note",
        "crea una página",
        "crear una página",
        "haz una página",
        "haz una nota",
        "crée une page",
        "crée une note",
        "créer une page",
        "créer une note",
    )
    memory_patterns = (
        "guarda-ho a la memòria",
        "guarda això a la memòria",
        "desa-ho a la memòria",
        "desa això a la memòria",
        "recorda que ",
        "recorda això",
        "save this to memory",
        "store this in memory",
        "remember that ",
        "guárdalo en la memoria",
        "guarda esto en la memoria",
        "recuerda que ",
        "mémorise ",
        "enregistre ceci en mémoire",
    )
    authorized = _base_write_tools(
        text,
        cornell_actions,
        page_patterns,
        memory_patterns,
    )

    intent_patterns = {
        "create_table_row": (
            "crea una fila",
            "afegeix una fila",
            "create a row",
            "add a row",
            "crea una fila",
            "añade una fila",
            "crée une ligne",
        ),
        "update_page": (
            "actualitza la pàgina",
            "edita la pàgina",
            "update the page",
            "edit the page",
            "actualiza la página",
            "modifie la page",
        ),
        "append_to_page": (
            "afegeix a la pàgina",
            "append to the page",
            "añade a la página",
            "ajoute à la page",
        ),
        "update_table_row": (
            "actualitza la fila",
            "edita la fila",
            "update the row",
            "edit the row",
            "actualiza la fila",
            "modifie la ligne",
        ),
        "add_tags": (
            "afegeix etiquetes",
            "afegeix l'etiqueta",
            "add tags",
            "add the tag",
            "añade etiquetas",
            "ajoute des étiquettes",
        ),
        "add_page_comment": (
            "afegeix un comentari",
            "add a comment",
            "añade un comentario",
            "ajoute un commentaire",
        ),
        "mark_task_complete": (
            "marca la tasca com",
            "completa la tasca",
            "mark the task complete",
            "complete the task",
            "marca la tarea como",
            "termine la tâche",
        ),
        "create_calendar_event": (
            "crea un esdeveniment",
            "afegeix al calendari",
            "create an event",
            "add to the calendar",
            "crea un evento",
            "crée un événement",
        ),
        "create_contact": (
            "crea un contacte",
            "afegeix un contacte",
            "create a contact",
            "add a contact",
            "crea un contacto",
            "crée un contact",
        ),
        "save_mail_draft": (
            "desa un esborrany",
            "guarda un esborrany",
            "save a draft",
            "draft an email",
            "guarda un borrador",
            "enregistre un brouillon",
        ),
    }
    authorized.update(_matching_pattern_tools(text, intent_patterns))

    delete_patterns = (
        "elimina la pàgina",
        "esborra la pàgina",
        "delete the page",
        "remove the page",
        "elimina la página",
        "supprime la page",
    )
    authorized.update(_matching_pattern_tools(text, {"delete_page": delete_patterns}))

    confirmation_request_patterns = {
        "delete_contact": (
            "elimina el contacte",
            "esborra el contacte",
            "delete the contact",
            "elimina el contacto",
            "supprime le contact",
        ),
        "send_mail": (
            "envia el correu",
            "envia aquest correu",
            "send the email",
            "send this email",
            "envía el correo",
            "envoie le courriel",
        ),
        "archive_mail": (
            "arxiva el correu",
            "archive the email",
            "archiva el correo",
            "archive le courriel",
        ),
        "move_mail": (
            "mou el correu",
            "move the email",
            "mueve el correo",
            "déplace le courriel",
        ),
        "invite_attendees": (
            "convida els assistents",
            "envia les invitacions",
            "invite attendees",
            "send the invitations",
            "invita a los asistentes",
            "invite les participants",
        ),
        "delete_table": (
            "elimina la taula",
            "esborra la taula",
            "delete the table",
            "elimina la tabla",
            "supprime la table",
        ),
        "restore_page_version": (
            "restaura la versió",
            "restore the version",
            "restaura la versión",
            "restaure la version",
        ),
        "empty_trash": (
            "buida la paperera",
            "empty the trash",
            "vacía la papelera",
            "vide la corbeille",
        ),
        "change_schema": (
            "canvia l'esquema",
            "substitueix l'esquema",
            "change the schema",
            "replace the schema",
            "cambia el esquema",
            "modifie le schéma",
        ),
        "bulk_update_rows": (
            "actualitza massivament",
            "actualitza totes les files",
            "bulk update",
            "update all rows",
            "actualiza masivamente",
            "mise à jour en masse",
        ),
        "replace_reference_ids_in_titles": (
            "substitueix els ids",
            "substitueix els identificadors",
            "replace the ids",
            "replace the identifiers",
            "reemplaza los ids",
            "reemplaza los identificadores",
            "remplace les identifiants",
        ),
    }
    authorized.update(_matching_pattern_tools(text, confirmation_request_patterns))
    authorized.update(_mention_write_tools(text, mentions or ()))

    return authorized


def _reader_context_analysis_requested(message: str) -> bool:
    """Recognize explicit whole-Reader analysis requests in supported languages."""
    text = " ".join((message or "").strip().lower().split())
    if not text:
        return False
    reader_terms = re.compile(
        r"\b(?:lector|reader|not[ií]cies|noticias|news|articles?|art[ií]culos?|"
        r"actualitat|actualidad|actualit[eé])\b",
        re.IGNORECASE,
    )
    broad_terms = re.compile(
        r"\b(?:tot(?:es|s)?|toda?s?|all|whole|entire|moltes?|much[oa]s?|many|"
        r"pendents?|pendientes?|unread|per\s+temes?|por\s+temas?|by\s+topic|"
        r"evoluci[oó]|evolution|[eé]volution|tend[eè]ncies|tendencias|trends?)\b",
        re.IGNORECASE,
    )
    actions = (
        "analitza",
        "analitza'm",
        "analitzar",
        "fes-me un resum",
        "resumeix",
        "compara",
        "classifica",
        "troba tendències",
        "detecta tendències",
        "analyze",
        "analyse",
        "summarize",
        "summarise",
        "compare",
        "classify",
        "find trends",
        "analiza",
        "analizar",
        "resume",
        "resúmeme",
        "compara",
        "clasifica",
        "encuentra tendencias",
        "analyse",
        "résume",
        "compare",
        "classe",
        "trouve les tendances",
    )
    negated_or_meta = re.search(
        r"\b(?:no|mai|nunca|never|not|don't|sense|sin|sans)\b"
        r"|\b(?:com|cómo|how)\s+(?:puc|puedo|to|do|can)\b"
        r"|^(?:explica|describe|tell me)\b",
        text,
        re.IGNORECASE,
    )
    return bool(
        reader_terms.search(text)
        and broad_terms.search(text)
        and not negated_or_meta
        and any(action in text for action in actions)
    )
