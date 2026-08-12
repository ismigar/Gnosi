"""Rich option catalogs, semantic field roles, and per-table seeds.

Implements the data model from the directive
`vault_option_catalogs_action_rules.md`:

  * `config.options` accepts TWO formats — legacy string ("CA") and rich object
    `{name, color?, group?}`. Reading normalizes it; writing always saves
    the rich format. An old registry loads without migrating.
  * `config.role` (`language` | `status` | `tags`) identifies the field that
    actions should use, falling back to the existing name heuristics.
  * Seeds: when saving a table (registry upsert), the base catalog of the
    status field is guaranteed, and the states required by active features
    are added to it («Translated», «Published to Drupal», «Published to Social Media»).
  * Named shared catalogs: `option_catalogs` block at the root of the registry;
    a field links to it with `config.catalog_ref` (never coexists with `options`).

Like `translation_helpers`: no I/O, no FastAPI, no backend imports
— data goes in, data comes out (testable with pytest without dragging in the app).
"""
import re
import unicodedata
from typing import Any, Dict, List, Optional, Tuple

# Field types with a selectable option catalog (mirror of OPTION_FIELD_TYPES
# of the SchemaConfigModal).
OPTION_TYPES = {"select", "multi_select", "status"}

# Closed color palette per option (the names are stable: the UI maps them
# to CSS). The automatic color is chosen by hashing the name — stable across Macs and
# between runs, with no shared state.
OPTION_COLOR_PALETTE = [
    "gray", "blue", "green", "yellow", "orange",
    "red", "purple", "pink", "brown", "teal",
]

# Default groups for a `status` field (Notion style: Initial · In progress · Final).
DEFAULT_STATUS_GROUPS = ["Inicial", "En curs", "Final"]

# Status seed catalog (Ismael's decision, directive §9.1). "Draft" and
# "Reviewed" always; the rest are added according to the active features.
STATUS_DRAFT = "Esborrany"
STATUS_REVIEWED = "Revisat"
STATUS_TRANSLATED = "Traduït"
STATUS_PUBLISHED_DRUPAL = "Publicat a Drupal"
STATUS_PUBLISHED_SOCIAL = "Publicat a XXSS"

BASE_STATUS_SEED: List[Tuple[str, str]] = [
    (STATUS_DRAFT, "Inicial"),
    (STATUS_REVIEWED, "En curs"),
]

ROLE_LANGUAGE = "language"
ROLE_STATUS = "status"
ROLE_TAGS = "tags"

# Every field whose persisted type is `status` uses this root catalog. Select
# fields named "Status" are still allowed to have a table-local catalog; the
# global rule applies to the dedicated status field type only.
STATUS_CATALOG_REF = "status"

# Name heuristics for assigning roles (same synonyms as
# translation_helpers._LANGUAGE_FIELD_NAMES for the language field).
_ROLE_FIELD_NAMES = {
    ROLE_LANGUAGE: {"idioma", "llengua", "language", "lang", "lengua", "lingua"},
    ROLE_STATUS: {"estat", "estado", "status", "state"},
    ROLE_TAGS: {"tags", "tag", "etiquetes", "etiquetas", "labels"},
}

# Allowed types for the NAME heuristic of each role. A "Status" field of
# text type (e.g. the lifecycle specific to "Social Posts") is NOT
# a semantic status field: it's neither seeded nor used by the actions. The role
# EXPLICIT (config.role) has no such restriction — intent takes precedence.
_ROLE_ALLOWED_TYPES = {
    ROLE_LANGUAGE: {"select", "status"},
    ROLE_STATUS: {"select", "status"},
    ROLE_TAGS: {"multi_select"},
}

# Signal for publishing to XXSS: `system` column named xxss/social (same
# regex as the frontend — isSocialPublishTable in VaultTable).
_SOCIAL_COLUMN_RE = re.compile(r"xxss|social", re.IGNORECASE)


def _strip_accents(text: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFD", text)
        if unicodedata.category(c) != "Mn"
    )


def _norm_name(name: Any) -> str:
    return _strip_accents(str(name or "").strip().lower())


def auto_color(name: str) -> str:
    """Stable color for an option without an explicit color.

    djb2-xor hash over the normalized name: trivially replicable in JS
    (optionCatalogUtils.js uses the SAME algorithm) so that an option
    not yet persisted is painted the same on the client as on the server.
    
    """
    h = 5381
    for ch in _norm_name(name):
        h = ((h * 33) ^ ord(ch)) & 0xFFFFFFFF
    return OPTION_COLOR_PALETTE[h % len(OPTION_COLOR_PALETTE)]


def normalize_option(opt: Any) -> Optional[Dict[str, Any]]:
    """An option (legacy string or rich dict) → rich dict, or None if invalid."""
    if isinstance(opt, dict):
        name = str(opt.get("name") or "").strip()
        if not name:
            return None
        out: Dict[str, Any] = {"name": name}
        color = str(opt.get("color") or "").strip().lower()
        out["color"] = color if color in OPTION_COLOR_PALETTE else auto_color(name)
        group = str(opt.get("group") or "").strip()
        if group:
            out["group"] = group
        return out
    if isinstance(opt, (str, int, float, bool)):
        name = str(opt).strip()
        if not name:
            return None
        return {"name": name, "color": auto_color(name)}
    return None


def normalize_options(options: Any) -> List[Dict[str, Any]]:
    """List of options in any format → rich list without duplicates
    (first occurrence wins, exact comparison by name)."""
    out: List[Dict[str, Any]] = []
    seen = set()
    for opt in options if isinstance(options, list) else []:
        norm = normalize_option(opt)
        if norm and norm["name"] not in seen:
            seen.add(norm["name"])
            out.append(norm)
    return out


def option_names(options: Any) -> List[str]:
    return [o["name"] for o in normalize_options(options)]


def get_prop_config(prop: dict) -> dict:
    cfg = prop.get("config")
    return cfg if isinstance(cfg, dict) else {}


def get_prop_options(prop: dict, option_catalogs: Optional[dict] = None) -> List[Dict[str, Any]]:
    """Effective options of a property, normalized.

    Priority (same as buildSchemaFromTableProperties on the frontend):
    `config.catalog_ref` (shared catalog) → `config.options` (nested, written
    by the inline PATCH) → top-level `options` (written by the modal's
    save).
    
    """
    cfg = get_prop_config(prop)
    ref = str(cfg.get("catalog_ref") or "").strip()
    if ref and isinstance(option_catalogs, dict) and isinstance(option_catalogs.get(ref), list):
        return normalize_options(option_catalogs[ref])
    if isinstance(cfg.get("options"), list):
        return normalize_options(cfg["options"])
    if isinstance(prop.get("options"), list):
        return normalize_options(prop["options"])
    return []


def is_global_status_prop(prop: dict) -> bool:
    """Return whether a property must use the global status catalog."""
    return str(prop.get("type") or "").strip() == "status"


def set_prop_options(prop: dict, options: List[Dict[str, Any]]) -> None:
    """Writes the (normalized) catalog to the canonical location `config.options`
    and removes the legacy top-level duplicate so they don't diverge."""
    cfg = prop.setdefault("config", {})
    cfg["options"] = normalize_options(options)
    prop.pop("options", None)


def prop_role(prop: dict) -> str:
    """Explicit role (`config.role`), or '' if it has none."""
    role = str(get_prop_config(prop).get("role") or "").strip().lower()
    return role if role in (ROLE_LANGUAGE, ROLE_STATUS, ROLE_TAGS) else ""


def find_role_prop(table: dict, role: str) -> Optional[dict]:
    """Table property by semantic role, with fallback to the name heuristic.

    The fallback guarantees compatibility with non-migrated tables: actions
    find the "Status"/"Language"/"Tags" field even if no one has assigned roles.
    
    """
    props = table.get("properties") or []
    for p in props:
        if prop_role(p) == role:
            return p
    names = _ROLE_FIELD_NAMES.get(role, set())
    allowed = _ROLE_ALLOWED_TYPES.get(role, OPTION_TYPES)
    for p in props:
        if _norm_name(p.get("name")) in names and p.get("type") in allowed:
            return p
    return None


def table_has_social_column(table: dict) -> bool:
    for p in table.get("properties") or []:
        cfg = get_prop_config(p)
        is_system = p.get("system") is True or cfg.get("system") is True
        if is_system and _SOCIAL_COLUMN_RE.search(str(p.get("name") or "")):
            return True
    return False


def assign_roles(table: dict) -> bool:
    """Assigns `config.role` by name to fields that don't have one (idempotent).

    Only option-type fields (for status/tags) or select (for language):
    a free-text field named "Status" is left untouched.
    
    """
    changed = False
    taken = {prop_role(p) for p in table.get("properties") or [] if prop_role(p)}
    for p in table.get("properties") or []:
        if prop_role(p):
            continue
        if p.get("type") not in OPTION_TYPES:
            continue
        name = _norm_name(p.get("name"))
        for role, names in _ROLE_FIELD_NAMES.items():
            if name in names and role not in taken:
                if role == ROLE_TAGS and p.get("type") != "multi_select":
                    continue
                if role in (ROLE_LANGUAGE, ROLE_STATUS) and p.get("type") == "multi_select":
                    continue
                p.setdefault("config", {})["role"] = role
                taken.add(role)
                changed = True
                break
    return changed


def ensure_options_exist(prop: dict, wanted: List[Tuple[str, str]]) -> bool:
    """Ensures the `(name, group)` options are in the field's catalog.

    Normalizes the existing catalog (strings → rich format) and adds any that
    are missing. Does not touch or reorder existing ones. Returns True if it
    modified anything. Fields with `catalog_ref` are left untouched (the shared
    catalog belongs to the user).
    
    """
    cfg = get_prop_config(prop)
    if str(cfg.get("catalog_ref") or "").strip():
        return False
    existing = get_prop_options(prop)
    before = [dict(o) for o in existing]
    have = {o["name"] for o in existing}
    for name, group in wanted:
        if name not in have:
            opt: Dict[str, Any] = {"name": name, "color": auto_color(name)}
            if group:
                opt["group"] = group
            existing.append(opt)
            have.add(name)
    raw_options = get_prop_config(prop).get("options") or prop.get("options")
    needs_normalize = raw_options is not None and normalize_options(raw_options) != raw_options
    if existing != before or needs_normalize or (raw_options is None and existing):
        set_prop_options(prop, existing)
        return True
    return False


def ensure_status_seed(table: dict) -> bool:
    """Seed-on-enable for the status field (directive §3.3, decision §9.1).

    Base catalog "Draft"/"Reviewed" always; "Translated" if the table is
    translatable; "Published to Drupal" / "Published to XXSS" if they have
    the feature active. Also ensures `option_groups` for status fields.
    Does nothing if the table has no status field.
    
    """
    prop = find_role_prop(table, ROLE_STATUS)
    if not prop:
        return False
    wanted = list(BASE_STATUS_SEED)
    if table.get("translation_enabled"):
        wanted.append((STATUS_TRANSLATED, "En curs"))
    if table.get("drupal_sync_enabled"):
        wanted.append((STATUS_PUBLISHED_DRUPAL, "Final"))
    if table_has_social_column(table):
        wanted.append((STATUS_PUBLISHED_SOCIAL, "Final"))
    changed = ensure_options_exist(prop, wanted)
    if prop.get("type") == "status":
        cfg = prop.setdefault("config", {})
        if not isinstance(cfg.get("option_groups"), list) or not cfg.get("option_groups"):
            cfg["option_groups"] = list(DEFAULT_STATUS_GROUPS)
            changed = True
    return changed


def normalize_table_options(table: dict) -> bool:
    """Canonicalizes the catalogs of all option fields in a table:
    rich format + single location (`config.options`). Idempotent."""
    changed = False
    for p in table.get("properties") or []:
        if p.get("type") not in OPTION_TYPES:
            continue
        cfg = get_prop_config(p)
        if str(cfg.get("catalog_ref") or "").strip():
            # With a shared catalog there are no local options: if any are left over from
            # once read, they're withdrawn (they never coexist, directive §3.1).
            if cfg.get("options") is not None or p.get("options") is not None:
                cfg.pop("options", None)
                p.pop("options", None)
                changed = True
            continue
        raw = cfg.get("options") if isinstance(cfg.get("options"), list) else p.get("options")
        if raw is None:
            continue
        normalized = normalize_options(raw)
        if raw != normalized or "options" in p:
            set_prop_options(p, normalized)
            changed = True
    return changed


def ensure_table_seeds(table: dict) -> bool:
    """Single entry point for saving a table (registry upsert): normalizes
    catalogs, assigns roles by name and seeds statuses. Idempotent."""
    changed = normalize_table_options(table)
    changed = assign_roles(table) or changed
    changed = ensure_status_seed(table) or changed
    return changed


def ensure_global_status_catalog(registry: dict) -> bool:
    """Migrate every dedicated status field to one registry-wide catalog.

    Status values are persisted by name in row frontmatter, so separate
    per-table catalogs make the same lifecycle value mean different things in
    different tables. Existing local and referenced catalogs are merged in
    stable order, required feature states are seeded, and every `status`
    property is then pointed at ``option_catalogs[STATUS_CATALOG_REF]``.
    """
    if not isinstance(registry, dict):
        return False

    tables = registry.get("tables") or []
    root_catalogs = registry.get("option_catalogs")
    if not isinstance(root_catalogs, dict):
        root_catalogs = {}

    merged: List[Dict[str, Any]] = normalize_options(
        root_catalogs.get(STATUS_CATALOG_REF)
    )
    have = {option["name"] for option in merged}
    status_props: List[Tuple[dict, dict]] = []

    for table in tables:
        for prop in table.get("properties") or []:
            if not is_global_status_prop(prop):
                continue
            cfg = get_prop_config(prop)
            status_props.append((table, prop))
            existing = get_prop_options(prop, root_catalogs)
            for option in existing:
                if option["name"] not in have:
                    merged.append(option)
                    have.add(option["name"])

    if not status_props:
        return False

    if registry.get("option_catalogs") is not root_catalogs:
        registry["option_catalogs"] = root_catalogs

    wanted: List[Tuple[str, str]] = list(BASE_STATUS_SEED)
    if any(table.get("translation_enabled") for table, _ in status_props):
        wanted.append((STATUS_TRANSLATED, "En curs"))
    if any(table.get("drupal_sync_enabled") for table, _ in status_props):
        wanted.append((STATUS_PUBLISHED_DRUPAL, "Final"))
    if any(table_has_social_column(table) for table, _ in status_props):
        wanted.append((STATUS_PUBLISHED_SOCIAL, "Final"))

    for name, group in wanted:
        if name not in have:
            option: Dict[str, Any] = {"name": name, "color": auto_color(name)}
            if group:
                option["group"] = group
            merged.append(option)
            have.add(name)

    changed = normalize_options(root_catalogs.get(STATUS_CATALOG_REF)) != merged
    root_catalogs[STATUS_CATALOG_REF] = merged

    for _, prop in status_props:
        cfg = prop.setdefault("config", {})
        if cfg.get("catalog_ref") != STATUS_CATALOG_REF:
            cfg["catalog_ref"] = STATUS_CATALOG_REF
            changed = True
        if cfg.pop("options", None) is not None:
            changed = True
        if prop.pop("options", None) is not None:
            changed = True
        if not isinstance(cfg.get("option_groups"), list) or not cfg.get("option_groups"):
            cfg["option_groups"] = list(DEFAULT_STATUS_GROUPS)
            changed = True

    return changed
