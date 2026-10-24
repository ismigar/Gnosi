"""Create immutable public projections from explicitly selected registry identities."""
from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from functools import cmp_to_key
from dataclasses import dataclass, field
from pathlib import Path
from typing import cast
from urllib.parse import quote, unquote, urlsplit

import yaml
from fastapi import HTTPException
from markdown_it import MarkdownIt
from markdown_it.token import Token
from pydantic import JsonValue

from .models import BundleAsset, CatalogueItem, PublicRecord, SiteBundle, SiteConfig, SiteSource, safe_path
from .storage import SiteStore, fingerprint, private_json
from .translations import PublicTranslations, public_id
from .validation import validate_site


@dataclass
class Note:
    path: Path
    metadata: dict[str, JsonValue]
    body: str
    digest: str


def is_public_metadata(metadata: dict[str, JsonValue]) -> bool:
    """Use one privacy predicate for direct pages, collections and imported notes."""
    if metadata.get("private") or metadata.get("draft") or metadata.get("published") is False or metadata.get("public") is False:
        return False
    private_states = {"draft", "esborrany", "borrador", "private", "privat", "privado", "unpublished", "no publicat", "no publicado"}
    for key in ("Estat", "Status", "status", "state"):
        raw = metadata.get(key)
        if raw is False or (isinstance(raw, (int, float)) and raw == 0):
            return False
        if isinstance(raw, dict):
            raw = raw.get("value", raw.get("name", raw.get("label")))
        if isinstance(raw, str) and raw.strip().casefold() in private_states:
            return False
    return True


def verify_selected_ids(source: SiteSource, available_ids: set[str]) -> None:
    missing = set(source.page_ids) - available_ids - set(source.withdrawn_ids)
    if missing:
        raise HTTPException(409, "An explicitly selected page is unavailable; check OneDrive before publishing")


def bounded_read(path: Path, root: Path, maximum: int = 4_000_000) -> bytes:
    if path.is_symlink() or not path.resolve(strict=True).is_relative_to(root):
        raise HTTPException(409, "A selected file is outside the vault")
    before = path.stat()
    if before.st_size > maximum:
        raise HTTPException(422, "A selected file exceeds the publication size limit")
    with path.open("rb") as stream:
        raw = stream.read(maximum + 1)
    after = path.stat()
    if len(raw) > maximum or (before.st_mtime_ns, before.st_size) != (after.st_mtime_ns, after.st_size):
        raise HTTPException(409, "A selected file changed while it was being read")
    return raw


def registry(store: SiteStore) -> tuple[dict[str, JsonValue], str]:
    path = store.vault / "BD" / "vault_db_registry.json"
    try:
        raw = bounded_read(path, store.vault)
        data: object = json.loads(raw)
        if not isinstance(data, dict):
            raise ValueError("Invalid registry")
        return cast(dict[str, JsonValue], data), hashlib.sha256(raw).hexdigest()
    except (OSError, ValueError):
        raise HTTPException(409, "The vault registry is unavailable; publication was stopped") from None


def records(data: dict[str, JsonValue], key: str) -> list[dict[str, JsonValue]]:
    value = data.get(key)
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, dict)]


def notes(store: SiteStore) -> list[Note]:
    result: list[Note] = []
    identities: set[str] = set()
    for path in sorted(store.vault.rglob("*.md")):
        relative = path.relative_to(store.vault)
        if any(part.startswith(".") for part in relative.parts) or path.is_symlink():
            continue
        try:
            raw = bounded_read(path, store.vault)
            text = raw.decode("utf-8")
            match = re.match(r"\A---\s*\n(.*?)\n---\s*\n", text, re.S)
            if not match:
                continue
            meta: object = yaml.safe_load(match.group(1))
            if not isinstance(meta, dict) or not meta.get("id"):
                continue
            metadata = cast(dict[str, JsonValue], json.loads(json.dumps(meta, default=str)))
            identity = str(metadata["id"])
            if identity in identities:
                raise HTTPException(409, "Duplicate note identities must be resolved before publication")
            identities.add(identity)
            result.append(Note(path, metadata, text[match.end():], hashlib.sha256(raw).hexdigest()))
        except (OSError, UnicodeError, yaml.YAMLError, ValueError):
            raise HTTPException(409, "A vault file is unavailable or incomplete; publication was stopped") from None
    return result


def fields(table: dict[str, JsonValue]) -> list[dict[str, str]]:
    raw = table.get("properties") or []
    if isinstance(raw, dict):
        raw = [dict(value, id=key) if isinstance(value, dict) else {"id": key, "name": str(value)} for key, value in raw.items()]
    if not isinstance(raw, list):
        return []
    return [{"id": str(p.get("id") or p.get("key") or ""), "name": str(p.get("name") or p.get("label") or p.get("id") or ""), "type": str(p.get("type") or "text")} for p in raw if isinstance(p, dict) and (p.get("id") or p.get("key"))]


def catalogue(store: SiteStore) -> list[CatalogueItem]:
    data, _ = registry(store) if (store.vault / "BD/vault_db_registry.json").exists() else ({}, "")
    tables = {str(t.get("id")): t for t in records(data, "tables")}
    output = [CatalogueItem(id=tid, kind="table", title=str(t.get("name") or tid), fields=fields(t)) for tid, t in tables.items()]
    for view in records(data, "views"):
        table_id = str(view.get("table_id") or "")
        output.append(CatalogueItem(id=str(view.get("id")), kind="view", title=str(view.get("name") or view.get("id")), table_id=table_id, fields=fields(tables.get(table_id, {}))))
    for note in notes(store):
        output.append(CatalogueItem(id=str(note.metadata["id"]), kind="page", title=str(note.metadata.get("title") or note.metadata.get("Títol") or note.path.stem)))
    if any(site.legacy_pilot for site in store.list()):
        from .importer import imported_catalogue
        output.extend(imported_catalogue(store))
    return output


def value_for(note: Note, field_id: str, table: dict[str, JsonValue]) -> JsonValue:
    props = fields(table)
    definition = next((field for field in props if field["id"] == field_id), None)
    if definition is None:
        raise HTTPException(409, "A selected field no longer exists")
    return note.metadata.get(field_id, note.metadata.get(definition["name"]))


def match_rule(note: Note, rule: dict[str, JsonValue], table: dict[str, JsonValue]) -> bool:
    field_id = str(rule.get("field_id") or rule.get("field") or "")
    prop = next((p for p in fields(table) if p["id"] == field_id or p["name"] == field_id), None)
    if not prop:
        raise HTTPException(409, "A view filter field is unavailable")
    actual = value_for(note, prop["id"], table)
    expected = rule.get("value")
    operator = str(rule.get("operator") or "equals")
    if expected == "this" or isinstance(expected, dict) or rule.get("periodPart"):
        raise HTTPException(422, "This view filter requires a publication-specific filter")
    if operator in {"equals", "is"}:
        return actual == expected
    if operator in {"not_equals", "not_equal", "is_not"}:
        return actual != expected
    if operator == "contains":
        return expected in actual if isinstance(actual, list) else str(expected or "").casefold() in str(actual or "").casefold()
    if operator in {"not_empty", "is_not_empty"}:
        return actual not in (None, "", [])
    if operator == "is_empty":
        return actual in (None, "", [])
    if operator == "in" and isinstance(expected, list):
        return actual in expected
    raise HTTPException(422, "This view filter is not supported for publication")


def match_tree(note: Note, tree: dict[str, JsonValue], table: dict[str, JsonValue]) -> bool:
    rules = tree.get("rules")
    if not isinstance(rules, list):
        return match_rule(note, tree, table)
    matched = [match_tree(note, rule, table) for rule in rules if isinstance(rule, dict)]
    if len(matched) != len(rules):
        raise HTTPException(422, "The saved view contains an invalid filter")
    return any(matched) if tree.get("conjunction") == "or" else all(matched)


def _explicit_public_notes(source: SiteSource, selected: list[Note]) -> list[Note]:
    result = [note for note in selected if is_public_metadata(note.metadata) and str(note.metadata["id"]) not in source.withdrawn_ids]
    if source.selection_mode == "selected" or source.page_ids:
        result = [note for note in result if str(note.metadata["id"]) in source.page_ids]
    return result


def _direct_notes(source: SiteSource, all_notes: list[Note]) -> list[Note]:
    if source.filters:
        raise HTTPException(422, "Configure filters on a table or saved view source")
    selected = [note for note in all_notes if note.metadata["id"] == source.source_id]
    if not selected:
        raise HTTPException(409, "A selected page is missing")
    return _explicit_public_notes(source, selected)


def _source_table(source: SiteSource, data: dict[str, JsonValue]) -> tuple[dict[str, JsonValue], dict[str, JsonValue] | None]:
    view = next((v for v in records(data, "views") if v.get("id") == source.source_id), None) if source.kind == "view" else None
    if source.kind == "view" and not view:
        raise HTTPException(409, "A selected view is missing")
    table_id = str(view.get("table_id")) if view else source.source_id
    table = next((t for t in records(data, "tables") if str(t.get("id")) == table_id), None)
    if not table:
        raise HTTPException(409, "A selected table is missing")
    return table, view


def _table_notes(all_notes: list[Note], data: dict[str, JsonValue], table: dict[str, JsonValue], vault: Path) -> list[Note]:
    from backend.domains.vault.tables.rows import build_table_folder_index, resolve_table_id_from_context
    folder_index = build_table_folder_index(cast(dict[object, object], data))
    return [note for note in all_notes if resolve_table_id_from_context(cast(dict[object, object], note.metadata), str(note.path.parent.relative_to(vault)), folder_index) == str(table.get("id"))]


def _view_notes(selected: list[Note], view: dict[str, JsonValue] | None, table: dict[str, JsonValue]) -> list[Note]:
    if not view:
        return selected
    tree = view.get("filterTree")
    if isinstance(tree, dict):
        return [note for note in selected if match_tree(note, tree, table)]
    rules = view.get("filters")
    if not rules:
        return selected
    if not isinstance(rules, list) or not all(isinstance(rule, dict) for rule in rules):
        raise HTTPException(422, "Invalid saved view filters")
    return [note for note in selected if all(match_rule(note, rule, table) for rule in rules if isinstance(rule, dict))]


def _source_sort_rules(source: SiteSource, view: dict[str, JsonValue] | None) -> list[tuple[str, str]]:
    if source.sort_field_id:
        return [(source.sort_field_id, "desc" if source.sort_descending else "asc")]
    if not view:
        return []
    raw = view.get("sorts") or view.get("sort") or []
    raw = [raw] if isinstance(raw, dict) else raw
    if not isinstance(raw, list):
        raise HTTPException(422, "Invalid saved view ordering")
    result: list[tuple[str, str]] = []
    for sort in raw:
        if not isinstance(sort, dict) or not isinstance(sort.get("field"), str) or sort.get("direction", "asc") not in {"asc", "desc"}:
            raise HTTPException(422, "Unsupported saved view ordering")
        result.append((str(sort["field"]), str(sort.get("direction", "asc"))))
    return result


def _normalized_sorts(table: dict[str, JsonValue], rules: list[tuple[str, str]]) -> list[tuple[str, str]]:
    definitions = fields(table)
    result: list[tuple[str, str]] = []
    for field_id, direction in rules:
        if field_id == "title":
            result.append((field_id, direction))
            continue
        definition = next((prop for prop in definitions if prop["id"] == field_id or prop["name"] == field_id), None)
        if not definition or definition["type"] in {"formula", "rollup", "virtual"}:
            raise HTTPException(422, "This saved view ordering requires an explicitly supported publication field")
        result.append((definition["id"], direction))
    return result


def _order_notes(selected: list[Note], table: dict[str, JsonValue], source: SiteSource, view: dict[str, JsonValue] | None) -> list[Note]:
    from backend.domains.vault.views.sorting import compare_field_values
    rules = _normalized_sorts(table, _source_sort_rules(source, view))
    def compare_notes(first: Note, second: Note) -> int:
        for field_id, direction in rules:
            first_value = first.metadata.get("title") if field_id == "title" else value_for(first, field_id, table)
            second_value = second.metadata.get("title") if field_id == "title" else value_for(second, field_id, table)
            result = compare_field_values(first_value, second_value, direction)
            if result:
                return result
        return 0
    if rules:
        selected.sort(key=cmp_to_key(compare_notes))
    return selected


def source_notes(source: SiteSource, all_notes: list[Note], data: dict[str, JsonValue], vault: Path, *, imported: bool = False) -> tuple[list[Note], dict[str, JsonValue]]:
    if source.source_id.startswith("imported:"):
        if not imported:
            raise HTTPException(409, "This imported source is not registered for the website")
        return [], {}
    verify_selected_ids(source, {str(note.metadata["id"]) for note in all_notes})
    if source.kind == "page":
        return _direct_notes(source, all_notes), {}
    table, view = _source_table(source, data)
    selected = _view_notes(_table_notes(all_notes, data, table, vault), view, table)
    for rule in source.filters:
        selected = [note for note in selected if match_rule(note, cast(dict[str, JsonValue], rule.model_dump(mode="json")), table)]
    return _order_notes(_explicit_public_notes(source, selected), table, source, view), table


def slug(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", normalized).strip("-")[:80] or "page"


@dataclass
class AssetExporter:
    store: SiteStore
    hashes: dict[str, str]
    site_id: str
    assets: dict[str, BundleAsset] = field(default_factory=dict)
    links: dict[str, str] = field(default_factory=dict)

    def _local_path(self, raw_path: str, note: Note | None) -> Path:
        candidates = [(note.path.parent / raw_path)] if note and not raw_path.startswith("/") else []
        candidates.extend([self.store.vault / raw_path.lstrip("/"), self.store.vault / "Attachments" / raw_path.lstrip("/")])
        local = next((path for path in candidates if path.is_file()), None)
        if local is None:
            raise HTTPException(409, "A selected public asset is missing")
        return local

    def _snapshot(self, local: Path) -> tuple[str, str, Path]:
        raw = bounded_read(local, self.store.vault, 32_000_000)
        digest = hashlib.sha256(raw).hexdigest()
        suffix = local.suffix.lower()
        if suffix not in {".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif", ".pdf", ".mp3", ".mp4", ".ogg", ".woff", ".woff2", ".stl", ".obj", ".3mf", ".step", ".stp", ".dxf"}:
            raise HTTPException(422, "Unsupported public attachment type")
        directory = self.store.site_dir(self.site_id) / "asset-snapshots"
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        snapshot = directory / (digest + suffix)
        if not snapshot.exists():
            snapshot.write_bytes(raw)
            snapshot.chmod(0o600)
        return "/assets/" + digest[:24] + suffix, digest, snapshot

    def __call__(self, value: str, note: Note | None = None) -> str:
        if value in self.assets:
            return value
        parsed = urlsplit(value)
        if parsed.scheme in {"http", "https"}:
            return value
        if parsed.scheme or value.startswith("//"):
            raise HTTPException(422, "Unsupported public asset URL")
        local = self._local_path(unquote(parsed.path), note)
        public_path, digest, snapshot = self._snapshot(local)
        self.assets[public_path] = BundleAsset(path=public_path, sha256=digest, private_source=str(snapshot))
        self.links[value] = public_path
        self.hashes[str(local.relative_to(self.store.vault))] = digest
        return public_path


def _note_identity(note: Note, translations: PublicTranslations, *, required: bool = True) -> tuple[str, str]:
    return public_id(note.metadata, translations.site), translations.language(note.metadata, required=required)


def _record(note: Note, source: SiteSource, translations: PublicTranslations, paths: dict[tuple[str, str], str]) -> PublicRecord:
    identity, language = _note_identity(note, translations)
    page_id = str(note.metadata["id"])
    title = str(note.metadata.get("title") or note.metadata.get("Títol") or note.path.stem)
    preferred = note.metadata.get("web_path") or note.metadata.get("drupal_path")
    path = paths.get((identity, language)) or (str(preferred) if preferred else f"/{language}{source.path_prefix.rstrip('/')}/{slug(title)}-{page_id[:8]}")
    try:
        safe_path(path)
    except ValueError:
        raise HTTPException(422, "A public note path is invalid") from None
    return PublicRecord(id=identity, language=language, path=path, title=title, translation_id=translations.group_id(note.metadata))


def _record_fields(record: PublicRecord, note: Note, source: SiteSource, table: dict[str, JsonValue], asset: AssetExporter) -> None:
    labels = {definition["id"]: definition["name"] for definition in fields(table)}
    for field_id in source.field_ids:
        record.fields[field_id] = value_for(note, field_id, table)
        record.field_labels[field_id] = labels.get(field_id, field_id)
    for field_id in source.attachment_field_ids:
        value = value_for(note, field_id, table)
        if isinstance(value, str) and value:
            record.fields[field_id] = asset(value, note)
        elif isinstance(value, list):
            record.fields[field_id] = [asset(item, note) for item in value if isinstance(item, str)]
        elif value is not None:
            raise HTTPException(422, "An attachment field does not contain file references")
        if field_id in record.fields:
            record.field_labels[field_id] = labels.get(field_id, field_id)


def _body_link(child: Token, asset: AssetExporter, links: dict[str, str], allowed_paths: set[str]) -> None:
    href = str(child.attrGet("href") or "")
    parsed = urlsplit(href)
    if parsed.scheme in {"https", "http", "mailto", "tel"}:
        if parsed.scheme in {"https", "http"}:
            child.attrSet("target", "_blank")
            child.attrSet("rel", "noopener noreferrer")
    elif href.startswith("#"):
        return
    elif href in asset.links:
        child.attrSet("href", asset.links[href])
    elif href in links:
        child.attrSet("href", links[href])
    elif href not in allowed_paths:
        raise HTTPException(422, "A public body links to an unpublished or unsupported internal page")


def _body_html(note: Note, asset: AssetExporter, links: dict[str, str], allowed_paths: set[str]) -> str:
    parser = MarkdownIt("commonmark", {"html": False, "linkify": False})
    tokens = parser.parse(note.body)
    for token in tokens:
        for child in token.children or []:
            if child.type == "image":
                child.attrSet("src", asset(str(child.attrGet("src") or ""), note))
            elif child.type == "link_open":
                _body_link(child, asset, links, allowed_paths)
    return cast(str, parser.renderer.render(tokens, parser.options, {}))


@dataclass
class Projection:
    store: SiteStore
    site: SiteConfig
    data: dict[str, JsonValue]
    all_notes: list[Note]
    previous_records: list[dict[str, JsonValue]]
    hashes: dict[str, str]
    public: dict[tuple[str, str], PublicRecord] = field(default_factory=dict)
    bodies: dict[tuple[str, str], Note] = field(default_factory=dict)
    asset: AssetExporter = field(init=False)
    paths: dict[tuple[str, str], str] = field(init=False)
    translations: PublicTranslations = field(init=False)

    def __post_init__(self) -> None:
        self.asset = AssetExporter(self.store, self.hashes, site_id=self.site.id)
        self.translations = PublicTranslations(self.site, [note.metadata for note in self.all_notes])
        self.paths = {(str(record.get("id")), str(record.get("language"))): str(record.get("path")) for record in self.previous_records}

    def collect(self) -> None:
        for source in self.site.sources:
            if not source.enabled:
                continue
            selected, table = source_notes(source, self.all_notes, self.data, self.store.vault, imported=self.site.legacy_pilot)
            for position, note in enumerate(selected):
                self._collect_note(source, note, table, position)

    def _collect_note(self, source: SiteSource, note: Note, table: dict[str, JsonValue], position: int) -> None:
        if self.site.legacy_pilot:
            from .importer import eligible_note
            if not eligible_note(note.metadata):
                return
        key = _note_identity(note, self.translations)
        if key[1] not in self.site.languages:
            return
        record = self.public.setdefault(key, _record(note, source, self.translations, self.paths))
        record.source_ids.append(source.id)
        record.source_order[source.id] = position
        _record_fields(record, note, source, table, self.asset)
        if source.include_body:
            if re.search(r"gnosi-view:|gnosi-view-snapshot", note.body, re.I):
                raise HTTPException(422, "Publish embedded table views through an explicitly selected website collection")
            self.bodies[key] = note
        self.hashes[str(note.path.relative_to(self.store.vault))] = note.digest

    def import_baseline(self) -> None:
        if not self.site.legacy_pilot:
            return
        from .importer import merge_imported_bundle
        merge_imported_bundle(self.store, self.site, self.public, self.asset.assets, self.hashes)
        for note in self.all_notes:
            if not is_public_metadata(note.metadata):
                identity = public_id(note.metadata, self.site)
                if not any(key[0] == identity for key in self.public):
                    continue
                for language in self.translations.private_languages(note.metadata):
                    self.public.pop((identity, language), None)

    def guard_missing_files(self) -> None:
        enabled_sources = {source.id for source in self.site.sources if source.enabled}
        known_ids = {public_id(note.metadata, self.site) for note in self.all_notes}
        withdrawn = {identity for source in self.site.sources for identity in source.withdrawn_ids}
        for old in self.previous_records:
            source_ids = old.get("source_ids", [])
            if not isinstance(source_ids, list):
                continue
            retained = enabled_sources.intersection(str(value) for value in source_ids)
            missing = str(old.get("id")) not in known_ids and str(old.get("id")) not in withdrawn
            if retained and missing and (str(old.get("id")), str(old.get("language"))) not in self.public:
                raise HTTPException(409, "A previously published source file is missing; select an explicit withdrawal after checking OneDrive")

    def render_bodies(self) -> None:
        links = {record.id: record.path for record in self.public.values()}
        for note in self.all_notes:
            key = _note_identity(note, self.translations, required=False)
            if key in self.public:
                links[str(note.metadata["id"])] = self.public[key].path
                links[str(note.path.relative_to(self.store.vault))] = self.public[key].path
        allowed = {record.path for record in self.public.values()} | {page.path for page in self.site.pages if page.enabled}
        for key, note in self.bodies.items():
            self.public[key].body_html = _body_html(note, self.asset, links, allowed)


def _projection(store: SiteStore, site: SiteConfig, target_id: str) -> Projection:
    has_sources = any(source.enabled for source in site.sources)
    data, registry_hash = registry(store) if has_sources or (store.vault / "BD/vault_db_registry.json").exists() else ({}, "")
    all_notes = notes(store) if has_sources else []
    previous = store.active_bundle(site.id, target_id)
    raw_records = previous.get("records", []) if previous else []
    previous_records = [record for record in raw_records if isinstance(record, dict)] if isinstance(raw_records, list) else []
    hashes = {"BD/vault_db_registry.json": registry_hash} if registry_hash else {}
    return Projection(store, site, data, all_notes, previous_records, hashes)


def _exported_site(site: SiteConfig, asset: AssetExporter) -> SiteConfig:
    exported = site.model_copy(deep=True)
    if exported.theme.logo and not urlsplit(exported.theme.logo).scheme:
        exported.theme.logo = asset(exported.theme.logo)
    if exported.theme.favicon and not urlsplit(exported.theme.favicon).scheme:
        exported.theme.favicon = asset(exported.theme.favicon)
    for font in exported.theme.fonts:
        if not urlsplit(font.src).scheme:
            font.src = asset(font.src)
    for page in exported.pages:
        if not page.enabled:
            continue
        for block in page.blocks:
            if block.image and not urlsplit(block.image).scheme:
                block.image = asset(block.image)
            block.images = [asset(value) if not urlsplit(value).scheme else value for value in block.images]
    exported.sources = [source.model_copy(update={"filters": [], "page_ids": [], "withdrawn_ids": [], "sort_field_id": None, "selection_mode": "all"}) for source in exported.sources if source.enabled]
    exported.pages = [page for page in exported.pages if page.enabled]
    exported.forms = [form for form in exported.forms if form.enabled]
    return exported


def build_bundle(store: SiteStore, site: SiteConfig, target_id: str) -> SiteBundle:
    validate_site(site)
    projection = _projection(store, site, target_id)
    projection.collect()
    projection.import_baseline()
    projection.guard_missing_files()
    projection.render_bodies()
    exported = _exported_site(site, projection.asset)
    bundle = SiteBundle(site=exported, records=list(projection.public.values()), assets=list(projection.asset.assets.values()), source_hashes=projection.hashes)
    public_paths = [record.path for record in bundle.records] + [page.path for page in exported.pages]
    if len(public_paths) != len(set(public_paths)):
        raise HTTPException(422, "Two selected pages own the same public URL")
    bundle.fingerprint = fingerprint({"site": site.model_dump(mode="json"), "records": [record.model_dump(mode="json") for record in bundle.records], "hashes": projection.hashes, "assets": [{"path": item.path, "sha256": item.sha256} for item in bundle.assets]})
    private_json(store.site_dir(site.id) / "last-export.json", {"fingerprint": bundle.fingerprint, "records": len(bundle.records)})
    return bundle
