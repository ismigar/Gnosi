"""Deterministic multilingual intent and authorization classification."""

from __future__ import annotations

import re
import unicodedata
from typing import Optional

from backend.domains.agent.write_intent import (
    _explicit_brain_write_tool_names,
    _reader_context_analysis_requested,
)

AUTO_SIMPLE_KEYWORDS = {
    "resumen",
    "resume",
    "traduce",
    "translate",
    "corrige",
    "fix",
    "explica",
    "explain",
    "titulo",
    "title",
    "idea",
    "ideas",
    "email",
    "tweet",
}


AUTO_COMPLEX_KEYWORDS = {
    "arquitectura",
    "architecture",
    "refactor",
    "debug",
    "analiza",
    "analyze",
    "investiga",
    "plan",
    "diseña",
    "design",
    "migración",
    "migration",
    "seguridad",
    "security",
    "sql",
    "backend",
    "frontend",
    "api",
    "performance",
    "rendimiento",
}


def _obvious_route(message: str, has_context: bool = False) -> Optional[str]:
    """Route obvious requests without paying for a supervisor model call."""
    text = (message or "").strip().lower()
    if not text:
        return "General"
    has_mention = "@[" in text or "selected mentions context:" in text
    table_action = any(
        word in text
        for word in (
            "table",
            "tables",
            "taula",
            "taules",
            "tabla",
            "tablas",
        )
    ) and any(
        word in text
        for word in (
            "replace",
            "replaces",
            "reemplaza",
            "reemplazar",
            "substitueix",
            "substituir",
            "actualitza",
            "actualizar",
            "update",
            "actualitza",
            "títol",
            "títols",
            "titulo",
            "títulos",
            "title",
            "titles",
            "fila",
            "files",
            "row",
            "rows",
            "registre",
            "registres",
        )
    )
    tool_intent = any(
        word in text
        for word in (
            "calendar",
            "calendari",
            "calendario",
            "meeting",
            "reunió",
            "reunion",
            "reuniones",
            "mail",
            "email",
            "correu",
            "correo",
            "notion",
            "zotero",
            "weather",
            "temps",
            "tiempo",
            "search",
            "cerca",
            "busca",
            "find",
        )
    )
    if (
        has_mention
        or table_action
        or tool_intent
        or (
            has_context
            and any(
                word in text
                for word in (
                    "document",
                    "documento",
                    "documentació",
                    "nota",
                    "pdf",
                    "vault",
                    "font",
                    "source",
                    "dades",
                    "datos",
                )
            )
        )
    ):
        return "Brain"
    if any(
        word in text
        for word in (
            "code",
            "codi",
            "código",
            "python",
            "typescript",
            "javascript",
            "bug",
            "error",
            "test",
            "api",
            "backend",
            "frontend",
        )
    ):
        return "Coder"
    if text.startswith(
        (
            "hola",
            "hello",
            "hi",
            "bon dia",
            "gràcies",
            "gracias",
            "merci",
            "explica",
            "explain",
            "resume",
            "resum",
            "traduce",
            "tradueix",
        )
    ):
        return "General"
    return None


def _normalized_request_text(message: str) -> str:
    """Normalize multilingual request text for deterministic routing only."""
    decomposed = unicodedata.normalize("NFKD", str(message or "").casefold())
    return " ".join(
        re.sub(
            r"[^a-z0-9]+",
            " ",
            "".join(character for character in decomposed if not unicodedata.combining(character)),
        ).split()
    )


def _inventory_or_lookup_mode(text: str) -> str:
    record_terms = re.search(
        r"\b(?:registre|registres|registro|registros|record|records|"
        r"recurs|recursos|resource|resources|ressource|ressources|"
        r"font|fonts|fuente|fuentes|source|sources|"
        r"nota|notes|notas|article|articles|articulo|articulos|"
        r"tasca|tasques|tarea|tareas|task|tasks|"
        r"projecte|projectes|proyecto|proyectos|project|projects|"
        r"area|areas|arees|pagina|pagines|paginas|page|pages|"
        r"taula|taules|tabla|tablas|table|tables|fila|files|row|rows)\b",
        text,
    )
    inventory_signal = re.search(
        r"\b(?:quin|quina|quins|quines|que|which|what|combien|quels|quelles|"
        r"quant|quants|quantes|cuanto|cuantos|cuantas|how many|count|total|"
        r"tot|tots|totes|todo|todos|todas|all|every|entire|"
        r"llista|llistar|lista|listar|list|enumera|enumerate|"
        r"troba|cerca|busca|find|search|trouve|cherche)\b",
        text,
    )
    age_lookup = re.search(
        r"\b(?:quants anys te|cuantos anos tiene|how old is|quel age a)\b",
        text,
    )
    strong_inventory_operation = re.search(
        r"\b(?:llista|llistar|lista|listar|list|enumera|enumerate|"
        r"quants|quantes|cuantos|cuantas|how many|count|combien|"
        r"troba tots|troba totes|busca todos|busca todas|find all|search all|"
        r"what do i have|mostra(?: m)?|ensenya(?: m)?|muestra(?: me)?|"
        r"show(?: me)?|display|dona(?: m)?|dame|give(?: me)?|"
        r"affiche(?: moi)?)\b"
        r"|\b(?:quins|quines)\b.{0,64}\btinc\b"
        r"|\bque\b.{0,64}\btengo\b"
        r"|\bwhich\b.{0,64}\bdo i have\b"
        r"|\b(?:quels|quelles)\b.{0,64}\bai je\b",
        text,
    )
    if age_lookup:
        return "lookup"
    if strong_inventory_operation:
        asks_how = re.search(
            r"\b(?:mostra|ensenya|muestra|show|display|dona|dame|give|"
            r"affiche)\b.{0,24}\b(?:com|como|how|comment)\b",
            text,
        )
        return "lookup" if asks_how and not record_terms else "inventory"
    integration = re.search(
        r"\b(?:notion|zotero|mail|email|correu|correo|calendar|calendari|"
        r"calendario|contact|contacte|contacto|reader|weather|meteo|web|"
        r"internet)\b",
        text,
    )
    if integration and inventory_signal:
        return "lookup"
    if record_terms and inventory_signal:
        return "inventory"
    if re.search(
        r"\b(?:qui|que|quin|quan|on|com|who|what|when|where|how|"
        r"quien|cuando|donde|como|quel|quelle|quand|ou|comment|"
        r"troba|cerca|busca|find|search|trouve|cherche)\b",
        text,
    ):
        return "lookup"
    return "conversation"


def _request_mode(message: str) -> str:
    """Classify the operation independently from the request's subject."""
    text = _normalized_request_text(message)
    if not text:
        return "conversation"
    if _reader_context_analysis_requested(message):
        return "analysis"
    if _explicit_brain_write_tool_names(message) or re.match(
        r"^(?:(?:si us plau|por favor|please|s il vous plait)\s+)?"
        r"(?:delete|remove|send|publish|schedule|rename|move|archive|"
        r"elimina|esborra|envia|publica|programa|reanomena|mou|arxiva|"
        r"borra|manda|renombra|mueve|archiva|"
        r"supprime|envoie|publie|planifie|renomme|deplace|archive)\b",
        text,
    ):
        return "action"
    if re.search(
        r"\b(?:quins|quines|cuales|which|llista|lista|list|tots|totes|"
        r"todos|todas|all)\b.{0,80}\b(?:contenen|contienen|contain|contains|"
        r"mencionen|mencionan|mention|parlen|parlent|hablan|discuss)\b",
        text,
    ):
        return "inventory"
    if re.search(
        r"\b(?:analitza|analitzar|analiza|analizar|analyze|analyse|"
        r"resumeix|resum|resume|summari[sz]e|synthese|sintetitza|sintetiza|"
        r"compara|compare|classifica|clasifica|classify|"
        r"explica|explain|explique|interpreta|interpret|"
        r"diu|diuen|dice|dicen|say|says|parlent|cont[eé]nen|contienen|contain|contains|"
        r"tendencies|tendencias|trends|themes|temes|temas|"
        r"connexions|conexiones|connections|relations|"
        r"idees principals|ideas principales|main ideas|pros and cons)\b",
        text,
    ):
        return "analysis"
    if re.match(r"^(?:hola|hello|hi|bon dia|bona tarda|bona nit|salut|bonjour)\b", text) and (
        len(text.split()) <= 6
    ):
        return "conversation"
    return _inventory_or_lookup_mode(text)
