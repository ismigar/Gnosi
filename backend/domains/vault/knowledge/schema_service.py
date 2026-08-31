"""Typed Vault domain extracted from the historical route facade."""

import importlib as _legacy_importlib
from typing import TYPE_CHECKING, TypeVar

from backend.domains.configuration import (
    llm_wiki_records as _llm_wiki_records,
    llm_wiki_schema as _llm_wiki_schema,
)
from backend.domains.vault.pages.foundation_values import PageMetadata
from backend.domains.vault.registry.records import RecordReader, is_record
from backend.utils.open_values import (
    append_value,
    get_value,
    integer_value,
    iterable_values,
    mapping_items,
    set_value,
    unpack_pair,
)

if TYPE_CHECKING:
    from backend.api import vault_routes as _legacy
else:
    _legacy = _legacy_importlib.import_module("backend.api.vault_routes")
_BRAIN_SCHEMA_DEFINITIONS: list[tuple[str, str, dict[str, str]]] = [
    (
        "note_type",
        "select",
        {"ca": "Tipus de nota", "en": "Note type", "es": "Tipo de nota", "fr": "Type de note"},
    ),
    (
        "idea_type",
        "select",
        {"ca": "Tipus d’idea", "en": "Idea type", "es": "Tipo de idea", "fr": "Type d’idée"},
    ),
    ("position", "number", {"ca": "Posició", "en": "Position", "es": "Posición", "fr": "Position"}),
    (
        "based_on",
        "relation",
        {"ca": "Basada en", "en": "Based on", "es": "Basada en", "fr": "Basée sur"},
    ),
    (
        "verification",
        "select",
        {
            "ca": "Estat de verificació",
            "en": "Verification status",
            "es": "Estado de verificación",
            "fr": "État de vérification",
        },
    ),
    (
        "last_reviewed",
        "date",
        {
            "ca": "Última revisió",
            "en": "Last reviewed",
            "es": "Última revisión",
            "fr": "Dernière révision",
        },
    ),
    ("areas", "multi_select", {"ca": "Àrees", "en": "Areas", "es": "Áreas", "fr": "Domaines"}),
    (
        "tags",
        "multi_select",
        {"ca": "Etiquetes", "en": "Tags", "es": "Etiquetas", "fr": "Étiquettes"},
    ),
]
_BRAIN_SOURCE_NAMES = {"ca": "Font", "en": "Source", "es": "Fuente", "fr": "Source"}
_BRAIN_SOURCE_SINGULAR_TOKENS = {"font", "source", "fuente"}
_BRAIN_SOURCE_PLURAL_TOKENS = {"fonts", "sources", "fuentes"}
BRAIN_SOURCE_CONTRACT_REVISION = 2
Config = dict[str, object]
ConfigT = TypeVar("ConfigT", Config, PageMetadata)
_BRAIN_VIEW_DEF_RE = _legacy.re.compile("<!--\\s*gnosi-view:def\\s+(?P<payload>\\{.*?\\})\\s*-->")
_BRAIN_ROLE_SPECS: dict[str, tuple[set[str], str]] = {
    "note_type": ({"tipusdenota", "notetype", "tipodenota", "typedenote"}, "select"),
    "idea_type": (
        {"tipus", "tipusdidea", "ideatype", "tipodeidea", "typedidee", "classe"},
        "select",
    ),
    "position": ({"posicio", "position", "ordre"}, "number"),
    "verification": (
        {
            "estatdeverificacio",
            "verificationstatus",
            "estadodeverificacion",
            "etatdeverification",
            "estat",
        },
        "select",
    ),
    "last_reviewed": (
        {"ultimarevisio", "lastreviewed", "reviewdate", "ultimarevision", "derniererevision"},
        "date",
    ),
    "areas": ({"arees", "area", "areas", "domaines"}, "multi_select"),
    "tags": ({"tags", "etiquetes", "etiquetas", "etiquettes"}, "multi_select"),
}


def _brain_property(role: str, name: str, ptype: str, brain_table_id: str = "") -> PageMetadata:
    """Build a localized seed property while keeping relation targets stable."""
    prop: PageMetadata = {"id": str(_legacy.uuid.uuid4()), "name": name, "type": ptype}
    if ptype == "relation":
        if role == "based_on":
            if brain_table_id:
                prop["relation_database_id"] = brain_table_id
                prop["cardinality"] = "many-to-many"
    return prop


def _brain_schema(locale: str = "en") -> list[tuple[str, str, str]]:
    language = str(locale or "en").split("-", 1)[0].lower()
    if language not in {"ca", "en", "es", "fr"}:
        language = "en"
    return [
        (role, names[language], property_type)
        for role, property_type, names in _BRAIN_SCHEMA_DEFINITIONS
    ]


def _brain_role_tokens(role: str) -> set[str]:
    definition = next((item for item in _BRAIN_SCHEMA_DEFINITIONS if item[0] == role), None)
    if not definition:
        return set()
    tokens = {_brain_schema_token(name) for name in definition[2].values()}
    tokens.update({"idea_type": {"tipus", "classe"}, "areas": {"area"}}.get(role, set()))
    return tokens


def _ensure_default_db_group() -> None:
    """Guarantee the `gnosi_vault_db` databases entry so tables created under
    it (for example, the Brain) show up in the sidebar, which groups by
    `registry.databases`. Folder "BD" — the Notion-clone convention — keeps the
    physical resolution VAULT/BD/<table.folder> unchanged (the disabled global
    bootstrap uses "Databases/Gnosi", which would MOVE existing tables)."""
    with _legacy.registry_mutation():
        reg = _legacy.load_registry()
        dbs = reg.setdefault("databases", [])
        if any((get_value(d, "id") == "gnosi_vault_db" for d in iterable_values(dbs))):
            return
        append_value(dbs, {"id": "gnosi_vault_db", "name": "Gnosi Vault", "folder": "BD"})
        _legacy.save_registry(reg)
        _legacy.log.info("🧠 Created the `gnosi_vault_db` database group in the sidebar registry")


_BRAIN_SCHEMA_DEPENDENCIES = _llm_wiki_schema.BrainSchemaDependencies(
    registry_mutation=lambda: _legacy.registry_mutation(),
    load_registry=lambda: _legacy.load_registry(),
    save_registry=lambda registry: _legacy.save_registry(registry),
    schema=lambda locale: _brain_schema(locale),
    schema_token=lambda value: _brain_schema_token(value),
    role_tokens=lambda role: _brain_role_tokens(role),
    new_property=lambda role, name, property_type, table_id: _brain_property(
        role, name, property_type, brain_table_id=table_id
    ),
    new_uuid=lambda: str(_legacy.uuid.uuid4()),
    source_name=lambda locale: _brain_source_name(locale),
    source_singular_tokens=frozenset(_BRAIN_SOURCE_SINGULAR_TOKENS),
    source_plural_tokens=frozenset(_BRAIN_SOURCE_PLURAL_TOKENS),
    migrate_source_metadata=lambda brain_id, canonical_name, legacy_names: (
        _migrate_brain_source_metadata(brain_id, canonical_name, legacy_names)
    ),
    normalize_source_views=lambda brain_id, source_id, canonical_name, names: (
        _normalize_brain_source_views(brain_id, source_id, canonical_name, names)
    ),
    logger=_legacy.log,
)


def ensure_brain_table_schema(
    table_id: str, locale: str = "en", property_id_hints: dict[str, str] | None = None
) -> int:
    """Add missing Brain fields and stable property ids idempotently."""
    return _llm_wiki_schema.ensure_brain_table_schema(
        table_id, locale, property_id_hints, _BRAIN_SCHEMA_DEPENDENCIES
    )


def _brain_schema_token(value: object) -> str:
    """Accent-insensitive token used only for semantic schema discovery."""
    import unicodedata

    normalized = unicodedata.normalize("NFKD", str(value or "").casefold())
    return "".join((ch for ch in normalized if ch.isalnum() and (not unicodedata.combining(ch))))


def _infer_brain_roles(table: RecordReader | None) -> dict[str, str]:
    """Map semantic role names to existing Brain property ids."""
    properties = [
        prop
        for prop in iterable_values((table or {}).get("properties") or [])
        if is_record(prop) and prop.get("id")
    ]
    roles = {}
    for role, (tokens, expected_type) in _BRAIN_ROLE_SPECS.items():
        candidate = next(
            (
                prop
                for prop in properties
                if _brain_schema_token(prop.get("name")) in tokens
                and (
                    str(prop.get("type") or "") == expected_type
                    or (
                        role == "areas"
                        and str(prop.get("type") or "") in {"relation", "select", "multi_select"}
                    )
                )
            ),
            None,
        )
        if candidate:
            roles[role] = str(candidate["id"])
    return roles


def _dimension_name_key(value: object) -> str:
    token = _brain_schema_token(value)
    return {
        "area": "area",
        "areas": "area",
        "arees": "area",
        "domaine": "area",
        "domaines": "area",
    }.get(token, token)


def _brain_property_id_hints(cfg: RecordReader, brain_table: RecordReader | None) -> dict[str, str]:
    """Recover legacy property ids from persisted role and dimension mappings."""
    hints: dict[str, str] = {}
    for pair in mapping_items(cfg.get("brain_roles") or {}):
        role, property_id = unpack_pair(pair)
        stable_id = str(property_id or "")
        if not stable_id:
            continue
        for token in _brain_role_tokens(str(role)):
            hints[token] = stable_id
    brain_properties = [
        prop
        for prop in iterable_values((brain_table or {}).get("properties") or [])
        if is_record(prop)
    ]
    for field_id in iterable_values(cfg.get("index_field_ids") or []):
        stable_id = str(field_id or "")
        source_keys: set[str] = set()
        for source in iterable_values(cfg.get("source_tables") or []):
            mapping = get_value(get_value(source, "dimension_mappings") or {}, stable_id) or {}
            source_property_id = str(get_value(mapping, "source_property_id") or "")
            source_table = _legacy._table_by_id(str(get_value(source, "table_id") or "")) or {}
            source_property = next(
                (
                    prop
                    for prop in iterable_values(source_table.get("properties") or [])
                    if str(get_value(prop, "id") or "") == source_property_id
                ),
                None,
            )
            if source_property:
                source_keys.add(_dimension_name_key(get_value(source_property, "name")))
        candidates = [
            prop
            for prop in brain_properties
            if _dimension_name_key(prop.get("name")) in source_keys
        ]
        if len(candidates) == 1:
            hints[_brain_schema_token(candidates[0].get("name"))] = stable_id
    return hints


def _brain_source_name(locale: str) -> str:
    language = str(locale or "en").split("-", 1)[0].lower()
    return _BRAIN_SOURCE_NAMES.get(language, _BRAIN_SOURCE_NAMES["en"])


def _relation_values(value: object) -> list[object]:
    if value in (None, "", [], {}):
        return []
    return list(value) if isinstance(value, list) else [value]


def _relation_value_key(value: object) -> str:
    text = str(value or "").strip()
    match = _legacy.RELATION_WIKILINK_RE.match(text)
    return str(match.group("rid") if match else text)


def _merge_relation_values(*values: object) -> list[object]:
    merged: list[object] = []
    seen: set[str] = set()
    for value in values:
        for item in _relation_values(value):
            key = _relation_value_key(item)
            if not key or key in seen:
                continue
            seen.add(key)
            merged.append(item)
    return merged


def _migrate_brain_source_metadata(
    brain_table_id: object, canonical_name: str, legacy_names: set[str]
) -> int:
    """Move duplicate source values to the canonical Brain relation."""
    if not legacy_names:
        return 0
    migrated = 0
    for page in _legacy._get_pages_for_table(brain_table_id) or []:
        path_value = getattr(page, "path", None)
        path = _legacy.Path(path_value) if path_value else None
        if not path or not path.exists():
            continue
        try:
            metadata, body = _legacy.parse_frontmatter(path.read_text(encoding="utf-8"), path)
            present = [name for name in legacy_names if name in metadata]
            if not present:
                continue
            metadata[canonical_name] = _merge_relation_values(
                metadata.get(canonical_name), *(metadata.get(name) for name in present)
            )
            for name in present:
                metadata.pop(name, None)
            _legacy.save_page_md(path, metadata, body)
            _legacy.register_page_in_index(path)
            migrated += 1
        except Exception as error:
            _legacy.log.warning("Could not migrate a Brain source relation in %s: %s", path, error)
    return migrated


def _source_filter_rule(canonical_name: str) -> PageMetadata:
    return {"field": canonical_name, "value": "this"}


def _is_source_filter(rule: object, source_names: set[str]) -> bool:
    return is_record(rule) and _brain_schema_token(rule.get("field")) in {
        _brain_schema_token(name) for name in source_names
    }


def _strip_source_filter_nodes(node: object, source_names: set[str]) -> object:
    if not is_record(node):
        return node
    rules = node.get("rules")
    if not isinstance(rules, list):
        return None if _is_source_filter(node, source_names) else dict(node)
    kept = [
        child
        for rule in rules
        if (child := _strip_source_filter_nodes(rule, source_names)) is not None
    ]
    if not kept:
        return None
    if len(kept) == 1:
        return kept[0]
    result = dict(node)
    result["rules"] = kept
    return result


def _normalize_brain_source_view(
    view: PageMetadata, canonical_name: str, source_names: set[str]
) -> bool:
    """Guarantee one contextual source filter while preserving other filters."""
    before = _legacy.json.dumps(view, sort_keys=True, ensure_ascii=False)
    source_rule = _source_filter_rule(canonical_name)
    filters = view.get("filters")
    if isinstance(filters, list):
        remaining = [rule for rule in filters if not _is_source_filter(rule, source_names)]
        view["filters"] = [source_rule, *remaining]
    elif isinstance(view.get("filter"), dict):
        legacy_filter = view.pop("filter")
        remaining = [] if _is_source_filter(legacy_filter, source_names) else [legacy_filter]
        view["filters"] = [source_rule, *remaining]
    else:
        view["filters"] = [source_rule]
    filter_tree = view.get("filterTree")
    if isinstance(filter_tree, dict):
        remaining_tree = _strip_source_filter_nodes(filter_tree, source_names)
        view["filterTree"] = (
            source_rule
            if remaining_tree is None
            else {"conjunction": "and", "rules": [source_rule, remaining_tree]}
        )
    return before != _legacy.json.dumps(view, sort_keys=True, ensure_ascii=False)


def _embedded_view_ids_for_table(table_id: str) -> set[str]:
    view_ids: set[str] = set()
    for page in _legacy._get_pages_for_table(table_id) or []:
        path_value = getattr(page, "path", None)
        path = _legacy.Path(path_value) if path_value else None
        if not path or not path.exists():
            continue
        try:
            raw = path.read_text(encoding="utf-8")
        except Exception as error:
            _legacy.log.warning("Could not inspect embedded views in %s: %s", path, error)
            continue
        for match in _BRAIN_VIEW_DEF_RE.finditer(raw):
            try:
                payload: object = _legacy.json.loads(match.group("payload"))
            except (TypeError, ValueError):
                continue
            view_id = str(get_value(payload, "view_id") or "").strip()
            if view_id:
                view_ids.add(view_id)
    return view_ids


def _normalize_brain_source_views(
    brain_table_id: object, source_table_id: str, canonical_name: str, source_names: set[str]
) -> int:
    """Repair every Brain view embedded in pages of one configured source."""
    embedded_ids = _embedded_view_ids_for_table(source_table_id)
    if not embedded_ids:
        return 0
    changed = 0
    with _legacy.registry_mutation():
        registry = _legacy.load_registry()
        views = registry.get("views") or []
        by_id = {
            str(view.get("id") or ""): view for view in iterable_values(views) if is_record(view)
        }
        pending = list(embedded_ids)
        while pending:
            view_id = pending.pop()
            view = by_id.get(view_id)
            if not view:
                continue
            for raw_tab_id in iterable_values(view.get("tabs") or []):
                tab_id = str(raw_tab_id or "")
                if tab_id and tab_id not in embedded_ids:
                    embedded_ids.add(tab_id)
                    pending.append(tab_id)
        for view_id in embedded_ids:
            view = by_id.get(view_id)
            if (
                not view
                or str(view.get("table_id") or "") != brain_table_id
                or (not view.get("embedded"))
            ):
                continue
            if _normalize_brain_source_view(view, canonical_name, source_names):
                changed += 1
        if changed:
            _legacy.save_registry(registry)
            _legacy.log.info(
                "LLM Wiki normalized %d embedded Brain source filters for table %s",
                changed,
                source_table_id,
            )
    return changed


def ensure_brain_source_relation(
    brain_table_id: object, source_table_id: str, locale: str = "en"
) -> str:
    """Return the single canonical Brain relation targeting one source table.

    A singular relation is preferred, duplicate plural relations are merged and
    removed, and resource-page views are normalized to filter by the host page.
    """
    return _llm_wiki_schema.ensure_brain_source_relation(
        brain_table_id, source_table_id, locale, _BRAIN_SCHEMA_DEPENDENCIES
    )


def _brain_record_dependencies() -> _llm_wiki_records.BrainRecordDependencies:
    from backend.services import llm_wiki_config, llm_wiki_storage

    return _llm_wiki_records.BrainRecordDependencies(
        table_by_id=lambda table_id: _legacy._table_by_id(table_id),
        pages_for_table=lambda table_id: _legacy._get_pages_for_table(table_id),
        parse_frontmatter=lambda content, path: _legacy.parse_frontmatter(content, path),
        source_title=lambda metadata, path, table, source: _legacy._llm_wiki_source_title(
            metadata, path, table, source
        ),
        merge_page_metadata=lambda metadata, page_id: llm_wiki_storage.merge_page_metadata(
            metadata, page_id
        ),
        prepare_managed_markdown=lambda metadata: llm_wiki_storage.prepare_managed_markdown(
            metadata
        ),
        save_page=lambda path, metadata, body: _legacy.save_page_md(path, metadata, body),
        register_page=lambda path: _legacy.register_page_in_index(path),
        metadata_note_type=lambda metadata: llm_wiki_config.metadata_note_type(metadata),
        note_type_value=lambda kind, config, prop: llm_wiki_config.note_type_value(
            kind, config, prop
        ),
        logger=_legacy.log,
    )


def _normalize_brain_page_contract(
    metadata: PageMetadata,
    config: RecordReader,
    brain_table: PageMetadata,
    source_titles: dict[tuple[str, str], str],
) -> bool:
    """Normalize visible note types, source cardinality, and source labels."""
    return _llm_wiki_records.normalize_brain_page_contract(
        metadata, config, brain_table, source_titles, _brain_record_dependencies()
    )


def _normalize_existing_brain_pages(brain_table_id: object, config: RecordReader) -> int:
    """Migrate existing managed notes to the current singular-source contract."""
    return _llm_wiki_records.normalize_existing_brain_pages(
        brain_table_id, config, _brain_record_dependencies()
    )


def _reconcile_llm_wiki_source_contract(
    cfg: ConfigT,
) -> ConfigT | Config:
    """Apply the singular-source schema and embedded-view migration once."""
    from backend.services import llm_wiki_config

    brain_id = str(cfg.get("brain_table_id") or "")
    if not brain_id or not _legacy._table_by_id(brain_id):
        return cfg
    locale = str(cfg.get("ui_locale") or "en")
    brain_table = _legacy._table_by_id(brain_id)
    _legacy.ensure_brain_table_schema(brain_id, locale, _brain_property_id_hints(cfg, brain_table))
    changed = (
        integer_value(cfg.get("source_contract_revision") or 0) < BRAIN_SOURCE_CONTRACT_REVISION
    )
    for source in iterable_values(cfg.get("source_tables") or []):
        relation_id = ensure_brain_source_relation(
            brain_id, str(get_value(source, "table_id") or ""), locale
        )
        if relation_id and relation_id != str(get_value(source, "relation_property_id") or ""):
            set_value(source, "relation_property_id", relation_id)
            changed = True
    roles = _infer_brain_roles(_legacy._table_by_id(brain_id))
    if roles != (cfg.get("brain_roles") or {}):
        cfg["brain_roles"] = roles
        changed = True
    _normalize_existing_brain_pages(brain_id, cfg)
    if cfg.get("source_contract_revision") != BRAIN_SOURCE_CONTRACT_REVISION:
        cfg["source_contract_revision"] = BRAIN_SOURCE_CONTRACT_REVISION
        changed = True
    return llm_wiki_config.set_full_config(cfg) if changed else cfg
