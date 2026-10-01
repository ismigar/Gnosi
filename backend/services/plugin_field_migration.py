"""Register required plugin fields when enabling an existing integration."""

from __future__ import annotations


def active_ui_locale(locale: str | None = None) -> str:
    if not locale:
        from backend.config.app_config import load_params

        locale = str(load_params(strict_env=False).settings.get("language") or "en")
    language = locale.split("-", 1)[0].lower()
    return language if language in {"ca", "en", "es", "fr"} else "en"


def ensure_knowledge_fields(locale: str | None = None) -> None:
    """Reconcile by ID; create only missing fields in the active UI locale."""
    from backend.api import vault_routes
    from backend.services import llm_wiki_config

    config = llm_wiki_config.load_config()
    config["ui_locale"] = active_ui_locale(locale)
    vault_routes._reconcile_llm_wiki_source_contract(config)
