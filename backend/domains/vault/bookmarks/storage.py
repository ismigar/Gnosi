"""Immutable operations converge when vault folders are synchronized.

Each operation has its own atomic JSON file. Local processes serialize read /
append using an OS file lock outside the synced vault. Lamport clocks order
causal operations; independent concurrent changes to one item use an operation
UUID tie break. Separate items never overwrite each other. Migration receipts
and deletion operations are retained so old devices cannot resurrect imports.
"""
from __future__ import annotations

import hashlib
import json
import tempfile
import uuid
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterator

from fastapi import HTTPException
from filelock import FileLock, Timeout
from pydantic import ValidationError

from backend.services.workspace_service import WorkspaceContext
from backend.utils.metadata_io import MetadataUnavailable, ensure_metadata_local, read_metadata_text
from backend.utils.safe_io import safe_write_json

from .schemas import BookmarkCollection, BookmarkEntry, BookmarkItem, JournalEvent, MigrationItem, SortMode

MAX_ENTRIES = 10000
MAX_EVENT_BYTES = 16 * 1024 * 1024


def fingerprint(entry: BookmarkEntry) -> str:
    return hashlib.sha256(entry.model_dump_json().encode()).hexdigest()


def semantic_fingerprint(entry: BookmarkEntry) -> str:
    """Identify a legacy alias independently of device-specific item IDs."""
    payload = {key: getattr(entry, key) for key in ("kind", "target", "label", "group")}
    return hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def stable_id(source: str) -> str:
    return uuid.uuid5(uuid.NAMESPACE_URL, "gnosi:bookmark:" + source).hex


@dataclass
class State:
    entries: dict[str, BookmarkEntry] = field(default_factory=dict)
    sources: set[str] = field(default_factory=set)
    order: list[str] = field(default_factory=list)
    sort_mode: SortMode = "manual"
    preference: str | None = None
    clock: int = 0
    created: dict[str, float] = field(default_factory=dict)
    default_favorites: set[str] = field(default_factory=set)
    migration_owned: set[str] = field(default_factory=set)
    legacy_page_tombstones: set[str] = field(default_factory=set)
    legacy_item_tombstones: set[str] = field(default_factory=set)

    def remove(self, bookmark_id: str) -> None:
        self.entries.pop(bookmark_id, None)
        self.created.pop(bookmark_id, None)
        self.default_favorites.discard(bookmark_id)
        self.migration_owned.discard(bookmark_id)
        if bookmark_id in self.order:
            self.order.remove(bookmark_id)

    def claim(self, entry: BookmarkEntry) -> None:
        self.sources.add("semantic:" + semantic_fingerprint(entry))
        if entry.kind == "page":
            self.sources.add("favorite:" + entry.target)

    def apply_migration(self, item: MigrationItem, created_at: float) -> None:
        if item.source in self.sources:
            return
        self.sources.add(item.source)
        if item.entry is not None:
            semantic = semantic_fingerprint(item.entry)
            already_claimed = "semantic:" + semantic in self.sources
            self.claim(item.entry)
            if already_claimed or semantic in self.legacy_item_tombstones or (item.entry.kind == "page" and item.entry.target in self.legacy_page_tombstones):
                return
            if item.source.startswith("browser:") and item.entry.kind == "page":
                # GET may have discovered favorites before the browser's
                # first import. Replace only untouched generated defaults;
                # custom aliases and groups always survive.
                redundant = [key for key in self.default_favorites
                             if key in self.entries and self.entries[key].target == item.entry.target]
                for key in redundant:
                    self.remove(key)
            # Independent devices may discover the same favorite alongside
            # a differently named/grouped bookmark; retain the custom one.
            equivalent = any(entry.kind == item.entry.kind and entry.target == item.entry.target
                and (item.source.startswith("favorite:") or (entry.label, entry.group) == (item.entry.label, item.entry.group))
                for entry in self.entries.values())
            if not equivalent:
                self.entries[item.entry.id] = item.entry
                self.migration_owned.add(item.entry.id)
                self.created.setdefault(item.entry.id, item.created_at if item.created_at is not None else created_at)
                if item.source.startswith("favorite:"):
                    self.default_favorites.add(item.entry.id)
                if item.entry.id not in self.order:
                    self.order.append(item.entry.id)

    def apply(self, event: JournalEvent) -> None:
        self.clock = max(self.clock, event.clock)
        explicit_dates = {entry.id: self.created[entry.id] for entry in event.entries if entry.id in self.created}
        self.legacy_page_tombstones.update(event.legacy_page_tombstones)
        self.legacy_item_tombstones.update(event.legacy_item_tombstones)
        for bookmark_id in list(self.migration_owned):
            entry = self.entries[bookmark_id]
            if semantic_fingerprint(entry) in self.legacy_item_tombstones or (entry.kind == "page" and entry.target in self.legacy_page_tombstones):
                self.remove(bookmark_id)
        for item in event.migrations:
            self.apply_migration(item, event.created_at)
        for bookmark_id in event.deleted:
            self.remove(bookmark_id)
        for entry in event.entries:
            if entry.id not in self.entries:
                self.order.append(entry.id)
            self.entries[entry.id] = entry
            self.claim(entry)
            self.migration_owned.discard(entry.id)
            self.default_favorites.discard(entry.id)
            self.created.setdefault(entry.id, explicit_dates.get(entry.id, event.created_at))
        if event.preference == "user" or (event.preference == "legacy" and self.preference is None):
            if event.order is not None:
                chosen = list(dict.fromkeys(item for item in event.order if item in self.entries))
                self.order = chosen + [item for item in self.order if item not in chosen]
            if event.sort_mode is not None:
                self.sort_mode = event.sort_mode
            self.preference = event.preference

    def collection(self) -> BookmarkCollection:
        return BookmarkCollection(entries=[BookmarkItem(**self.entries[key].model_dump(exclude={"created_at"}), created_at=self.created[key]) for key in self.order if key in self.entries], sort_mode=self.sort_mode)


class BookmarkStore:
    def __init__(self, context: WorkspaceContext):
        self.vault = Path(context.vault_path).absolute()
        scope = json.dumps([context.workspace_id, context.user_id], separators=(",", ":"))
        self.directory = self.vault / ".gnosi" / "bookmarks" / hashlib.sha256(scope.encode()).hexdigest()
        lock_key = hashlib.sha256((str(self.vault) + scope).encode()).hexdigest()
        self.lock = FileLock(str(Path(tempfile.gettempdir()) / ("gnosi-bookmarks-" + lock_key + ".lock")), timeout=15)

    def guard(self, path: Path) -> None:
        if not self.vault.is_dir():
            raise HTTPException(503, "Vault is unavailable")
        # Reject aliases throughout the selected vault and its metadata tree.
        if any(parent.is_symlink() for parent in (path, *path.parents)):
            raise HTTPException(409, "Bookmark metadata cannot use symlinks")
        if not path.is_relative_to(self.vault):
            raise HTTPException(409, "Bookmark metadata escaped its vault")
        for parent in reversed((path, *path.parents)):
            if parent.is_relative_to(self.vault) and ".gnosi" in parent.parts:
                ensure_metadata_local(parent)

    @contextmanager
    def transaction(self) -> Iterator[State]:
        try:
            self.guard(self.directory)
            with self.lock:
                self.guard(self.directory)
                self.directory.mkdir(parents=True, exist_ok=True)
                yield self.read()
        except MetadataUnavailable as exc:
            raise HTTPException(503, "Bookmark metadata is still downloading; retry shortly") from exc
        except Timeout as exc:
            raise HTTPException(503, "Bookmarks are busy; retry shortly") from exc
        except (OSError, ValidationError, ValueError) as exc:
            raise HTTPException(409, "Bookmark metadata is unreadable; existing data was preserved") from exc

    def read(self) -> State:
        events = []
        for path in self.directory.iterdir():
            # Atomic helper scratch files are not committed operations.
            if path.name.startswith(".") and path.name.endswith(".tmp"):
                continue
            self.guard(path)
            if path.suffix != ".json" or not path.is_file():
                raise ValueError("Unknown bookmark journal member")
            if path.stat().st_size > MAX_EVENT_BYTES:
                raise ValueError("Bookmark operation is too large")
            event = JournalEvent.model_validate_json(read_metadata_text(path))
            if path.name != event.id + ".json":
                raise ValueError("Bookmark operation identity mismatch")
            events.append(event)
        state = State()
        for event in sorted(events, key=lambda value: (value.clock, value.id)):
            state.apply(event)
        return state

    def append(self, state: State, **changes: object) -> BookmarkCollection:
        event = JournalEvent(clock=state.clock + 1, id=uuid.uuid4().hex, **changes)
        replacements = {entry.id: entry for entry in event.entries}
        deleted = set(event.deleted)
        removed = [entry for bookmark_id, entry in state.entries.items()
                   if bookmark_id in deleted or (bookmark_id in replacements and semantic_fingerprint(entry) != semantic_fingerprint(replacements[bookmark_id]))]
        # Explicit removal intent is retained independently of which old-device
        # operations have reached this backend. It never suppresses direct PUTs.
        event.legacy_item_tombstones = list(dict.fromkeys([*event.legacy_item_tombstones,
                                                          *(semantic_fingerprint(entry) for entry in removed)]))
        remaining = {key: entry for key, entry in state.entries.items() if key not in deleted}
        remaining.update(replacements)
        page_targets = {entry.target for entry in remaining.values() if entry.kind == "page"}
        event.legacy_page_tombstones = list(dict.fromkeys([*event.legacy_page_tombstones,
            *(entry.target for entry in removed if entry.kind == "page" and entry.target not in page_targets)]))
        candidate = State()
        candidate.entries = dict(state.entries)
        candidate.sources = set(state.sources)
        candidate.order = list(state.order)
        candidate.created = dict(state.created)
        candidate.default_favorites = set(state.default_favorites)
        candidate.migration_owned = set(state.migration_owned)
        candidate.legacy_page_tombstones = set(state.legacy_page_tombstones)
        candidate.legacy_item_tombstones = set(state.legacy_item_tombstones)
        candidate.sort_mode, candidate.preference = state.sort_mode, state.preference
        candidate.apply(event)
        if len(candidate.entries) > MAX_ENTRIES and len(candidate.entries) > len(state.entries):
            raise HTTPException(422, "Bookmark collection limit reached")
        path = self.directory / (event.id + ".json")
        self.guard(path)
        safe_write_json(path, event.model_dump())
        state.apply(event)
        return state.collection()


def legacy_item(entry: BookmarkEntry) -> MigrationItem:
    source = "browser:" + fingerprint(entry)
    # Always derive imported IDs from the complete original item. Two devices
    # reusing one old UUID for different values retain both copies on merge.
    return MigrationItem(source=source, entry=entry.model_copy(update={"id": stable_id(source)}))
