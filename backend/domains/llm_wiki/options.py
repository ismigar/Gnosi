"""Existing categorical values shared by Knowledge settings and processing."""

from backend.domains.vault.registry.records import RecordReader
from backend.domains.vault.tables.catalogs import get_prop_config, get_prop_options
from backend.utils.open_values import get_value


def categorical_options(prop: RecordReader) -> list[dict[str, str]]:
    """Resolve the active vault's catalog with the same precedence as table fields."""
    config = get_prop_config(prop)
    catalogs: object = None
    if config.get("catalog_ref"):
        from backend.api import vault_routes

        catalogs = vault_routes.load_registry().get("option_catalogs")
    # Imported legacy schemas may still nest options under the property type.
    effective = prop
    if not config.get("catalog_ref") and not isinstance(config.get("options"), list) and not isinstance(prop.get("options"), list):
        legacy = prop.get(str(prop.get("type") or "select")) or prop.get("select")
        effective = {"options": get_value(legacy or {}, "options")}
    return [
        {"label": str(option["name"]), "value": str(option["name"])}
        for option in get_prop_options(effective, catalogs)
    ]
