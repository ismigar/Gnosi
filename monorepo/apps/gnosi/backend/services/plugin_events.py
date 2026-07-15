"""Vault event bus for data plugins (phase 3).

Single hook point that connects backend code (imports, clones,
page writes) with third-party plugins that react to changes.
Third consumer, alongside `action_rules.py` (button actions) and the
`rule_engine`/automations (`property_change`); it does NOT replace either:

  * automations  → react to row data changes (property_change).
  * action_rules → govern button actions (pre-guard + effects).
  * plugin_events → notify EXTERNAL plugins of high-level events.

Standard events (add new ones sparingly):
  * page:updated   {page_id, title?}
  * page:created   {page_id, title?}
  * page:deleted   {page_id}
  * import:finished {source, count?}
  * clone:finished  {source, count?}

`emit()` is fire-and-forget and must NEVER crash the caller (a broken plugin
cannot take down an import). It runs the plugins in `plugin_sandbox`'s Node
sandbox on a separate thread with a timeout; errors are logged, not propagated.
"""
from __future__ import annotations

import threading
from typing import Any, Callable, Dict, List

from backend.config.logger_config import get_logger

logger = get_logger(__name__)

# Known events (documented; emitting new ones is free but they should be
# added here for discoverability).
KNOWN_EVENTS = {
    "page:updated",
    "page:created",
    "page:deleted",
    "import:finished",
    "clone:finished",
    "llm-wiki:ingested",
}

# Internal subscribers (non-plugins): e.g. tests or the backend's own services.
# Plugins do NOT register here; they are reached via the external dispatcher.
_subscribers: List[Callable[[str, Dict[str, Any]], None]] = []
_dispatcher: Callable[[str, Dict[str, Any]], None] | None = None
_lock = threading.Lock()


def subscribe(fn: Callable[[str, Dict[str, Any]], None]) -> Callable[[], None]:
    """Registers an internal subscriber. Returns a function to unsubscribe."""
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
    """Injects the dispatcher toward the data plugins (plugin_sandbox).

    It's injected at backend startup to avoid a circular import
    (plugin_sandbox → plugin_system → vault paths). If None, events
    only reach the internal subscribers.
    
    """
    global _dispatcher
    _dispatcher = fn


def emit(event: str, payload: Dict[str, Any] | None = None) -> None:
    """Emits an event. Fire-and-forget: it must NEVER raise toward the caller.

    Runs on a thread because dispatching to plugins (Node subprocess) can
    take a while; the code that triggered the event (saving a page) should
    not have to wait for it or fail because of a plugin.
    
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
