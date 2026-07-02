"""Bus d'esdeveniments del vault per a plugins de dades (fase 3).

Punt d'enganxada únic que connecta el codi del backend (imports, clons,
escriptura de pàgines) amb els plugins de tercers que reaccionen a canvis.
Tercer consumidor, al costat de `action_rules.py` (accions de botó) i el
`rule_engine`/automations (`property_change`); NO substitueix cap dels dos:

  * automations  → reaccionen a canvis de dades de fila (property_change).
  * action_rules → governen accions de botó (guarda prèvia + efectes).
  * plugin_events → notifiquen plugins EXTERNS d'esdeveniments d'alt nivell.

Esdeveniments estàndard (afegir-ne amb moderació):
  * page:updated   {page_id, title?}
  * page:created   {page_id, title?}
  * page:deleted   {page_id}
  * import:finished {source, count?}
  * clone:finished  {source, count?}

`emit()` és fire-and-forget i MAI ha de fer petar el caller (un plugin trencat
no pot tombar un import). Corre els plugins al sandbox Node de `plugin_sandbox`
en un thread separat amb timeout; els errors es registren, no es propaguen.
"""
from __future__ import annotations

import threading
from typing import Any, Callable, Dict, List

from backend.config.logger_config import get_logger

logger = get_logger(__name__)

# Esdeveniments coneguts (documentats; emetre'n de nous és lliure però caldria
# afegir-los aquí per descobribilitat).
KNOWN_EVENTS = {
    "page:updated",
    "page:created",
    "page:deleted",
    "import:finished",
    "clone:finished",
}

# Subscriptors interns (no-plugins): p. ex. tests o serveis del propi backend.
# Els plugins NO s'hi registren aquí; s'hi arriba via el dispatcher extern.
_subscribers: List[Callable[[str, Dict[str, Any]], None]] = []
_dispatcher: Callable[[str, Dict[str, Any]], None] | None = None
_lock = threading.Lock()


def subscribe(fn: Callable[[str, Dict[str, Any]], None]) -> Callable[[], None]:
    """Registra un subscriptor intern. Retorna una funció per desubscriure."""
    with _lock:
        _subscribers.append(fn)

    def _unsub() -> None:
        with _lock:
            try:
                _subscribers.remove(fn)
            except ValueError:
                pass

    return _unsub


def set_plugin_dispatcher(fn: Callable[[str, Dict[str, Any]], None] | None) -> None:
    """Injecta el despatxador cap als plugins de dades (plugin_sandbox).

    S'injecta des de l'arrencada del backend per evitar un import circular
    (plugin_sandbox → plugin_system → vault paths). Si és None, els
    esdeveniments només arriben als subscriptors interns.
    """
    global _dispatcher
    _dispatcher = fn


def emit(event: str, payload: Dict[str, Any] | None = None) -> None:
    """Emet un esdeveniment. Fire-and-forget: no llança MAI cap on el caller.

    Corre en un thread perquè el dispatch als plugins (subprocés Node) pot
    trigar; el codi que ha provocat l'esdeveniment (guardar una pàgina) no ha
    d'esperar-ho ni fallar per culpa d'un plugin.
    """
    data = dict(payload or {})
    if event not in KNOWN_EVENTS:
        logger.debug("plugin_events.emit: esdeveniment no estàndard %r", event)

    def _run() -> None:
        with _lock:
            subs = list(_subscribers)
            dispatcher = _dispatcher
        for fn in subs:
            try:
                fn(event, data)
            except Exception:  # noqa: BLE001
                logger.exception("Subscriptor intern ha fallat en %s", event)
        if dispatcher is not None:
            try:
                dispatcher(event, data)
            except Exception:  # noqa: BLE001
                logger.exception("Dispatcher de plugins ha fallat en %s", event)

    try:
        threading.Thread(target=_run, name=f"plugin-evt-{event}", daemon=True).start()
    except Exception:  # noqa: BLE001
        logger.exception("No s'ha pogut arrencar el thread d'esdeveniment %s", event)
