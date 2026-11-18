"""Locate website inputs without opening unrelated vault document bodies.

The page index is a locator, never publication authority. Every candidate is
read through the exporter again before membership, privacy or content is used.
Canonical source directories are freshly enumerated so new rows and duplicate
identities cannot be hidden by an old index.
"""
from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path
import unicodedata
from typing import TYPE_CHECKING, cast

from fastapi import HTTPException
from pydantic import JsonValue

from backend.services.translation_helpers import canonicalize_id
from backend.domains.vault.tables.rows import build_table_folder_index, normalize_relative_folder, resolve_table_id_from_context

from .models import SiteConfig
from .storage import fingerprint
from .translations import _native_origin

if TYPE_CHECKING:
    from .exporter import Note
    from .storage import SiteStore


def _bindings(site: SiteConfig) -> str:
    return fingerprint([site.legacy_pilot, site.languages, site.default_language,
                        [(source.id, source.kind, source.source_id) for source in site.sources
                         if source.enabled and not source.source_id.startswith('imported:')]])


def _explicit_ids(site: SiteConfig) -> set[str]:
    result: set[str] = set()
    for source in site.sources:
        if source.enabled and not source.source_id.startswith('imported:'):
            result.update(source.page_ids)
            if source.kind == 'page':
                result.add(source.source_id)
    return result


@dataclass(frozen=True)
class InputScope:
    site_id: str
    bindings: str
    requested_ids: frozenset[str]

    def require_site(self, site: SiteConfig, notes: list[Note]) -> None:
        available = self.requested_ids | {str(note.metadata['id']) for note in notes}
        if self.site_id != site.id or self.bindings != _bindings(site) or not _explicit_ids(site) <= available:
            raise HTTPException(409, 'The publication snapshot does not cover this website selection')


@dataclass(frozen=True)
class SourceSnapshot:
    """Fresh request-local inputs, never retained across reviews or confirmations."""

    vault: Path
    data: dict[str, JsonValue]
    registry_hash: str
    notes: list[Note]
    scope: InputScope | None = None

    def require_vault(self, store: SiteStore) -> None:
        if self.vault != store.vault.resolve():
            raise HTTPException(409, "The publication snapshot belongs to another vault")

    def require_site(self, store: SiteStore, site: SiteConfig) -> None:
        self.require_vault(store)
        if self.scope is not None:
            self.scope.require_site(site, self.notes)


def source_snapshot(store: SiteStore, *, site: SiteConfig | None = None, extra_page_ids: set[str] | None = None) -> SourceSnapshot:
    from . import exporter
    from .asset_files import parent_descriptor_cache, read_session
    from .note_parse_cache import parsed_metadata_context

    data, registry_hash = exporter.registry(store)
    if site is not None:
        with read_session(), parent_descriptor_cache(), parsed_metadata_context(store.private_root):
            inputs, scope = read_inputs(store, site, data, extra_page_ids or set())
        return SourceSnapshot(store.vault.resolve(), data, registry_hash, inputs, scope)
    return SourceSnapshot(store.vault.resolve(), data, registry_hash, exporter.notes(store))


def available_entries(vault: Path) -> list[dict[str, object]] | None:
    from backend.domains.vault.pages import index_service
    from backend.services.context_vars import active_vault_path
    token = active_vault_path.set(vault)
    try:
        # An unconfigured index is unavailable. Do not bootstrap the global API
        # or read application configuration from an isolated preview/renderer.
        return index_service.get_available_page_entries(vault)
    finally:
        active_vault_path.reset(token)


def _path(vault: Path, raw: object) -> Path | None:
    if not isinstance(raw, str) or not raw:
        return None
    path = Path(raw)
    path = path if path.is_absolute() else vault / path
    if not path.is_relative_to(vault) or any(part.startswith('.') for part in path.relative_to(vault).parts):
        return None
    if path.suffix != '.md':
        return None
    # Do not stat/resolve every index entry: only the chosen candidates reach
    # the descriptor-bound reader, which enforces physical path confinement.
    return path


def _directories(vault: Path, data: dict[str, JsonValue], table: dict[str, JsonValue]) -> list[Path]:
    from .exporter import records
    folder = normalize_relative_folder(table.get('folder'))
    if not folder:
        return []
    relative = Path(folder)
    if relative.is_absolute() or '..' in relative.parts:
        raise HTTPException(409, 'A website table location is outside the vault')
    database = next((item for item in records(data, 'databases') if item.get('id') == table.get('database_id')), {})
    base = normalize_relative_folder(database.get('folder')) or 'BD'
    candidates = [vault / relative, vault / 'BD' / relative, vault / base / relative]
    result: list[Path] = []
    for path in candidates:
        if path in result or not path.exists():
            continue
        if path.is_symlink() or not path.resolve().is_relative_to(vault.resolve()):
            raise HTTPException(409, 'A website table location is outside the vault')
        if path.is_dir():
            result.append(path)
    return result



def _locator_folders(data: dict[str, JsonValue]) -> dict[str, str]:
    from .exporter import records
    result = build_table_folder_index(cast(dict[object, object], data))
    databases = {str(item['id']): normalize_relative_folder(item.get('folder'))
                 for item in records(data, 'databases') if item.get('id')}
    for table in records(data, 'tables'):
        folder = normalize_relative_folder(table.get('folder'))
        base = databases.get(str(table.get('database_id'))) or 'BD'
        for candidate in (Path('BD') / folder, Path(base) / folder):
            if folder and not candidate.is_absolute() and '..' not in candidate.parts:
                # Canonical registrations win over compatibility aliases.
                result.setdefault(candidate.as_posix().lower(), str(table['id']))
    return result


def _walk(root: Path, vault: Path, table_ids: set[str], folders: dict[str, str]) -> set[Path]:
    owner = resolve_table_id_from_context({}, str(root.relative_to(vault)), folders)
    if owner and owner not in table_ids:
        raise HTTPException(409, 'A website source folder belongs to another registered table')

    def unavailable(error: OSError) -> None:
        raise HTTPException(409, 'A website source directory is unavailable') from error

    paths: set[Path] = set()
    for directory, directories, files in os.walk(root, followlinks=False, onerror=unavailable):
        parent = Path(directory)
        keep = []
        for name in directories:
            path = parent / name
            owner = resolve_table_id_from_context({}, str(path.relative_to(vault)), folders)
            if not name.startswith('.') and not path.is_symlink() and (not owner or owner in table_ids):
                keep.append(name)
        directories[:] = keep
        paths.update(parent / name for name in files if name.endswith('.md') and not name.startswith('.'))
    return paths


class _InputReader:
    def __init__(self, store: SiteStore, site: SiteConfig, data: dict[str, JsonValue], requested: set[str]):
        from . import exporter
        self.vault, self.site, self.data, self.requested = store.vault, site, data, requested
        sources = [source for source in site.sources if source.enabled and not source.source_id.startswith('imported:')]
        self.direct_ids = {canonicalize_id(value) for source in sources if source.kind == 'page'
                           for value in [source.source_id, *source.page_ids]}
        self.tables = {str(table['id']): table for source in sources if source.kind != 'page'
                       for table, _ in [exporter._source_table(source, data)]}
        self.folders = _locator_folders(data)
        self.hints: dict[Path, dict[str, JsonValue]] = {}
        for entry in available_entries(self.vault) or []:
            path, metadata = _path(self.vault, entry.get('path')), entry.get('metadata')
            if path is not None and isinstance(metadata, dict):
                self.hints[path] = cast(dict[str, JsonValue], metadata)
        self.roots = {root for table in self.tables.values() for root in _directories(self.vault, data, table)}
        self.paths = {path for root in self.roots for path in _walk(root, self.vault, set(self.tables), self.folders)}
        # Root notes are the legacy namespace for direct pages and metadata-bound
        # rows. Revalidate this namespace; never recurse into unrelated domains.
        self.paths.update(path for path in self.vault.glob('*.md') if not path.name.startswith('.') and not path.is_symlink())
        self.loaded: dict[Path, Note] = {}
        self.processed: set[Path] = set()
        self.aliases: dict[str, Path] = {}
        self.scanned, self.searched = set(self.roots), set[str]()
        self.translation_tables: set[str] = set()
        self.metadata_searched: set[str] = set()

    def relevant(self, metadata: dict[str, JsonValue], path: Path, wanted: set[str]) -> bool:
        identity = canonicalize_id(metadata.get('id'))
        if identity in wanted or canonicalize_id(_native_origin(metadata)) in wanted:
            return True
        owner = self.owner(metadata, path)
        return owner in self.tables or bool(self.site.legacy_pilot and (metadata.get('drupal_uuid') or metadata.get('translation_id')))

    def owner(self, metadata: dict[str, JsonValue], path: Path) -> str | None:
        return resolve_table_id_from_context(cast(dict[object, object], metadata), str(path.parent.relative_to(self.vault)), self.folders)

    def wanted(self) -> set[str]:
        wanted = {canonicalize_id(identity) for identity in self.requested}
        while True:
            previous = set(wanted)
            for note in self.loaded.values():
                if self.relevant(note.metadata, note.path, wanted):
                    wanted.add(canonicalize_id(note.metadata['id']))
                    for identity in (_native_origin(note.metadata), note.metadata.get('Original'), note.metadata.get('translation_id')):
                        if isinstance(identity, str) and identity:
                            wanted.add(canonicalize_id(identity))
            if previous == wanted:
                return wanted

    def locate(self, wanted: set[str]) -> None:
        from . import exporter
        # Cold direct pages and translation ancestors can use stable filenames
        # in another registered table. Enumerate names rather than bodies.
        unresolved = wanted - self.searched - {canonicalize_id(note.metadata['id']) for note in self.loaded.values()} - {canonicalize_id(value.get('id')) for value in self.hints.values()}
        if unresolved:
            for table in exporter.records(self.data, 'tables'):
                for root in _directories(self.vault, self.data, table):
                    table_ids = {str(item['id']) for item in exporter.records(self.data, 'tables')}
                    self.paths.update(path for path in _walk(root, self.vault, table_ids, self.folders)
                                      if canonicalize_id(path.stem) in unresolved)
            self.searched.update(unresolved)
        for path, metadata in self.hints.items():
            if self.relevant(metadata, path, wanted):
                self.paths.add(path)

    def _translation_table(self, note: Note) -> dict[str, JsonValue] | None:
        from . import exporter
        tables = exporter.records(self.data, 'tables')
        owner = self.owner(note.metadata, note.path)
        if owner:
            return next((item for item in tables if item.get('id') == owner), None)
        # Legacy BD aliases may locate direct pages without conferring table
        # membership in the exporter. Use only their fresh physical namespace
        # to discover translation dependencies, keeping selection unchanged.
        matches = [(len(root.parts), table) for table in tables
                   for root in _directories(self.vault, self.data, table) if note.path.is_relative_to(root)]
        if not matches:
            return None
        depth = max(item[0] for item in matches)
        deepest = {str(table['id']): table for length, table in matches if length == depth}
        if len(deepest) != 1:
            raise HTTPException(409, 'A website translation location is ambiguous')
        return next(iter(deepest.values()))

    def locate_headers(self, paths: set[Path], unresolved: set[str]) -> set[str]:
        from .asset_files import AssetFileError, bounded_frontmatter
        from .note_parse_cache import parse_metadata
        import hashlib
        import yaml
        found = set[str]()
        for path in sorted(paths - self.processed):
            if path.is_symlink():
                continue
            try:
                raw = bounded_frontmatter(path, self.vault)
            except (AssetFileError, OSError) as error:
                raise HTTPException(409, 'A page locator is unavailable; refresh the vault index') from error
            if not raw:
                continue
            try:
                metadata = parse_metadata('\n'.join(raw.decode('utf-8').splitlines()[1:-1]), hashlib.sha256(raw).hexdigest())
            except (UnicodeDecodeError, yaml.YAMLError):
                continue
            if metadata is not None and (canonicalize_id(metadata.get('id')) in unresolved
                                         or canonicalize_id(_native_origin(metadata)) in unresolved):
                self.paths.add(path)
                found.add(canonicalize_id(metadata.get('id')))
        return found

    def locate_metadata(self, wanted: set[str]) -> None:
        """Recover cold title-named direct pages/ancestors from headers only.

        A missing selected table row never triggers this broader locator search.
        Fresh target reads still establish all publication/translation authority.
        """
        from . import exporter
        known = {canonicalize_id(note.metadata['id']) for note in self.loaded.values()}
        explicit = {canonicalize_id(value) for value in self.requested}
        unresolved = (wanted - known - self.metadata_searched) & (self.direct_ids | (wanted - explicit))
        if not unresolved:
            return
        tables = [table for table in exporter.records(self.data, 'tables')
                  if 'web_publishable' not in table or table.get('web_publishable') is True]
        owners = {str(table['id']) for table in tables}
        paths = {path for table in tables for root in _directories(self.vault, self.data, table)
                 for path in _walk(root, self.vault, owners, self.folders)}
        found = self.locate_headers(paths, unresolved)
        remaining = unresolved - found
        if remaining:
            self.locate_headers(_walk(self.vault, self.vault, owners, self.folders) - paths, remaining)
        self.metadata_searched.update(unresolved)

    def _translation_domain(self, note: Note, wanted: set[str]) -> None:
        # A direct original also depends on native children for language hints.
        # Derive their namespace from the freshly verified owner's registry,
        # never from a cached hint or from an unrelated candidate.
        if canonicalize_id(note.metadata['id']) not in wanted and canonicalize_id(_native_origin(note.metadata)) not in wanted:
            return
        table = self._translation_table(note)
        if table is None:
            # Native page translations also live below unregistered originals.
            # Refresh their actual namespace from headers, including when the
            # original was located through a partial existing index.
            parent = note.path.parent
            if parent not in self.scanned:
                self.scanned.add(parent)
                self.locate_headers(_walk(parent, self.vault, set(self.tables) | self.translation_tables, self.folders), wanted)
            return
        owner = str(table['id']) if table is not None else ''
        if not owner or owner in self.tables or owner in self.translation_tables:
            return
        if table is not None:
            self.translation_tables.add(owner)
            for root in _directories(self.vault, self.data, table):
                self.paths.update(_walk(root, self.vault, set(self.tables) | self.translation_tables, self.folders))
                self.scanned.add(root)

    def _legacy_siblings(self, metadata: dict[str, JsonValue], path: Path) -> None:
        if self.owner(metadata, path) in (set(self.tables) | self.translation_tables) and path.parent != self.vault and path.parent not in self.scanned:
            # Expand legacy siblings only after reading the candidate and
            # verifying current table ownership; stale hints cannot expand scope.
            if path.parent.is_dir() and not path.parent.is_symlink():
                self.paths.update(_walk(path.parent, self.vault, set(self.tables) | self.translation_tables, self.folders))
            self.scanned.add(path.parent)

    def read_pending(self, pending: list[Path], wanted: set[str]) -> None:
        from . import exporter
        for path in pending:
            self.processed.add(path)
            self.hints.pop(path, None)
            if not path.exists():
                continue
            key = unicodedata.normalize('NFC', str(path))
            prior = self.aliases.get(key)
            if prior is not None and prior != path and path.samefile(prior):
                continue
            self.aliases[key] = path
            note = exporter._read_note(path, self.vault)
            if note is not None:
                self.loaded[path] = note
                self._translation_domain(note, wanted)
                self._legacy_siblings(note.metadata, path)
            else:
                self.paths.remove(path)

    def read(self) -> list[Note]:
        from . import exporter
        while True:
            wanted = self.wanted()
            self.locate(wanted)
            pending = sorted(self.paths - self.processed)
            if not pending:
                self.locate_metadata(wanted)
                pending = sorted(self.paths - self.processed)
                if not pending:
                    break
            self.read_pending(pending, wanted)
        result = list(self.loaded.values())
        identities = [str(note.metadata['id']) for note in result]
        if len(identities) != len(set(identities)):
            raise HTTPException(409, 'Duplicate note identities must be resolved before publication')
        for table in self.tables.values():
            if not _directories(self.vault, self.data, table) and not exporter._table_notes(result, self.data, table, self.vault):
                raise HTTPException(409, 'A website table location is unavailable; refresh the vault index')
        return result


def read_inputs(store: SiteStore, site: SiteConfig, data: dict[str, JsonValue], extra_ids: set[str]) -> tuple[list[Note], InputScope]:
    requested = _explicit_ids(site) | extra_ids
    scope = InputScope(site.id, _bindings(site), frozenset(requested))
    native = any(source.enabled and not source.source_id.startswith('imported:') for source in site.sources)
    if not native and not extra_ids and not site.legacy_pilot:
        return [], scope
    return _InputReader(store, site, data, requested).read(), scope
