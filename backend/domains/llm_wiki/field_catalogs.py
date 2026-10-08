"""Localized option catalogs and semantic values for generated Brain notes."""

from __future__ import annotations

from backend.domains.vault.registry.records import is_record
from backend.domains.vault.registry.state import RegistryData
from backend.domains.vault.tables.catalogs.core import get_prop_options, set_prop_options

IDEA_LABELS = {
    "ca": ("Entitat", "Concepte", "Resum", "Síntesi"),
    "en": ("Entity", "Concept", "Summary", "Synthesis"),
    "es": ("Entidad", "Concepto", "Resumen", "Síntesis"),
    "fr": ("Entité", "Concept", "Résumé", "Synthèse"),
}
SEMANTIC_KEYS = {
    "idea_type": ("entitat", "concepte", "resum", "síntesi"),
}


def ensure_catalog(prop: RegistryData, role: str, locale: str) -> None:
    """Seed missing semantic choices while preserving explicit existing labels."""
    labels = {"idea_type": IDEA_LABELS}.get(role)
    if labels is None:
        return
    config = prop.get("config")
    config = dict(config) if is_record(config) else {}
    raw_map = config.get("plugin_option_values")
    mapping = dict(raw_map) if is_record(raw_map) else {}
    options = get_prop_options(prop)
    names = {option["name"] for option in options}
    for index, key in enumerate(SEMANTIC_KEYS[role]):
        if mapping.get(key) in names:
            continue
        aliases = {key.casefold(), *(values[index].casefold() for values in labels.values())}
        existing = next((name for name in names if name.casefold() in aliases), None)
        label = existing or labels.get(locale, labels["en"])[index]
        if label not in names:
            options.append({"name": label, "color": ("gray", "green", "orange", "red")[index]})
            names.add(label)
        mapping[key] = label
    config["plugin_option_values"] = mapping
    prop["config"] = config
    set_prop_options(prop, options)


def catalog_value(prop: RegistryData | None, semantic: str) -> str:
    config = (prop or {}).get("config")
    mapping = config.get("plugin_option_values") if is_record(config) else None
    return str(mapping.get(semantic) or semantic) if is_record(mapping) else semantic
