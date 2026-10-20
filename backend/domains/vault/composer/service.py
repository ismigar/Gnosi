"""Build deterministic plans and apply them under the ordinary page write locks."""

from __future__ import annotations

import hashlib
import json
import os
import posixpath
import re
import uuid
from collections.abc import Callable
from contextlib import AsyncExitStack
from copy import deepcopy
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import quote, unquote, urlsplit

from fastapi import HTTPException

from backend.config.logger_config import get_logger
from backend.domains.vault.history.repository import HistoryRepository
from backend.domains.vault.pages.cache import get_page_write_lock
from backend.domains.vault.registry.state import RegistryData
from backend.utils.safe_io import file_etag, safe_write_bytes

from .markdown import anchor, anchors, rewrite_links, select
from .references import preserve_reference_context
from .schemas import (
    ComposerApplyRequest,
    ComposerChange,
    ComposerPreview,
    ComposerRequest,
    ComposerResult,
)

log = get_logger(__name__)


@dataclass(frozen=True)
class ComposerDependencies:
    parse: Callable[[str, Path], tuple[RegistryData, str]]
    save: Callable[[Path, RegistryData, str], None]
    refresh: Callable[[Path, RegistryData, str], None]
    # JSON dashboards require a different writer. Reject any operation needing their rewrite.
    unsupported_bodies: Callable[[], list[str]] = lambda: []
    validate_access: Callable[[], None] = lambda: None
    validate_pages: Callable[[list[str]], None] = lambda _: None
    local_prefixes: tuple[str, ...] = (
        "/vault/page/",
        "/vault/pages/",
        "/api/vault/page/",
        "/api/vault/pages/",
    )


@dataclass
class Document:
    id: str
    path: Path
    metadata: RegistryData
    body: str
    raw: bytes | None
    sidecar: bytes | None
    etag: str | None

    @property
    def title(self) -> str:
        return str(self.metadata.get("title") or self.path.stem)


def sidecar_path(root: Path, page_id: str) -> Path:
    if not page_id or re.search(r"[/\\\x00-\x1f]", page_id) or page_id in {".", ".."}:
        raise HTTPException(409, "A page has an unsafe identity")
    path = root / ".gnosi" / "page_meta" / f"{page_id}.json"
    if not path.resolve().is_relative_to(root):
        raise HTTPException(409, "Composer storage must remain inside the selected vault")
    return path


def read_optional(path: Path) -> bytes | None:
    return path.read_bytes() if path.exists() else None


def inventory(root: Path, dependencies: ComposerDependencies) -> dict[str, Document]:
    documents: dict[str, Document] = {}
    total_size = 0

    # Fresh reads deliberately bypass the link cache: apply must see newly added backlinks.
    def unreadable(error: OSError) -> None:
        raise HTTPException(409, "A folder could not be read; no changes were made") from error

    for folder, dirs, filenames in os.walk(root, followlinks=False, onerror=unreadable):
        if any(not d.startswith(".") and (Path(folder) / d).is_symlink() for d in dirs):
            raise HTTPException(409, "Composer cannot update links through symbolic links")
        dirs[:] = sorted(d for d in dirs if not d.startswith("."))
        for name in sorted(filenames):
            path = Path(folder) / name
            if path.suffix.lower() != ".md" or name.startswith("."):
                continue
            if path.is_symlink() or not path.resolve().is_relative_to(root):
                raise HTTPException(409, "Composer cannot update links through symbolic links")
            try:
                etag = file_etag(path)
                raw = path.read_bytes()
                total_size += len(raw)
                if total_size > 64_000_000 or len(documents) >= 20000:
                    raise HTTPException(
                        409, "This vault is too large for a single Composer operation"
                    )
                metadata, body = dependencies.parse(raw.decode("utf-8"), path)
                page_id = str(metadata.get("id") or metadata.get("migration_id") or path.stem)
                sidecar = read_optional(sidecar_path(root, page_id))
                if file_etag(path) != etag:
                    raise HTTPException(409, "A note changed while preparing the preview")
                if page_id in documents:
                    raise HTTPException(
                        409, "Duplicate page identities must be resolved before composing notes"
                    )
                documents[page_id] = Document(page_id, path, metadata, body, raw, sidecar, etag)
            except (OSError, UnicodeError) as error:
                raise HTTPException(
                    409, "A note could not be read; no changes were made"
                ) from error
    return documents


def _reference_resolver(
    documents: dict[str, Document], root: Path, source_id: str
) -> Callable[[str, str], str | None]:
    names: dict[str, set[str]] = {}
    paths = {page.path.relative_to(root).as_posix(): page.id for page in documents.values()}
    for page in documents.values():
        relative = page.path.relative_to(root).as_posix()
        aliases = page.metadata.get("aliases", [])
        values = [page.id, page.title, page.path.stem, relative, relative.removesuffix(".md")]
        if isinstance(aliases, list):
            values.extend(str(item) for item in aliases)
        elif isinstance(aliases, str):
            values.append(aliases)
        for value in values:
            names.setdefault(value.casefold(), set()).add(page.id)

    def resolve(reference: str, current_id: str) -> str | None:
        decoded = unquote(reference).removeprefix("./").removesuffix(".md")
        if decoded in documents:
            return decoded
        current = documents.get(current_id)
        if current and ("/" in reference or reference.endswith(".md")):
            relative = posixpath.normpath(
                str(current.path.parent.relative_to(root) / unquote(reference))
            )
            if relative in paths:
                return paths[relative]
        matches = names.get(decoded.casefold(), set())
        if len(matches) > 1:
            return "__ambiguous__" if source_id in matches else None
        return next(iter(matches), None)

    return resolve


def _retargeter(
    source_id: str,
    target_id: str,
    moved: set[str],
    whole: bool,
    current_id: str,
    resolve: Callable[[str, str], str | None],
    prefixes: tuple[str, ...],
) -> Callable[[str], str | None]:
    def retarget(raw: str) -> str | None:
        base, marker, section = raw.partition("#")
        # Keep URLs to other sites/vaults intact. Canonical local page paths retain their prefix.
        if re.match(r"^[a-z][\w+.-]*:", base, re.I) or base.startswith("//"):
            path = urlsplit(base).path
            for local_prefix in prefixes:
                if (
                    path.startswith(local_prefix)
                    and resolve(path[len(local_prefix) :], current_id) == source_id
                    and marker
                    and anchor(section) in moved
                ):
                    raise HTTPException(
                        409,
                        (
                            "An absolute URL links to the moved section; change it to a local note "
                            "link first"
                        ),
                    )
            return None
        prefix = ""
        for local_prefix in prefixes:
            if base.startswith(local_prefix):
                prefix, base = local_prefix, base[len(local_prefix) :]
                break
        referred = current_id if not base else resolve(base, current_id)
        if referred == "__ambiguous__":
            # An ambiguous title that includes the source must not be silently left dangling.
            raise HTTPException(409, "A link uses an ambiguous note title; use its page ID first")
        if referred != source_id:
            return None
        is_moved = whole or (bool(marker) and anchor(section) in moved)
        if is_moved:
            return f"{prefix}{target_id}{marker}{section}"
        # A local link in moved content still points back to the original note's remaining section.
        if not base and current_id == source_id:
            return f"{source_id}{marker}{section}"
        return None

    return retarget


@dataclass
class Plan:
    preview: ComposerPreview
    documents: dict[str, Document]


def _prepare_target(
    root: Path,
    request: ComposerRequest,
    target_id: str,
    documents: dict[str, Document],
    moved: set[str],
) -> Document:
    if request.mode == "extract":
        if target_id in documents:
            raise HTTPException(409, "The new note already exists; request a fresh preview")
        try:
            uuid.UUID(target_id)
        except ValueError as error:
            raise HTTPException(422, "New notes require a generated identity") from error
        path = root / "Wiki" / f"{target_id}.md"
        if not path.resolve().is_relative_to(root):
            raise HTTPException(409, "The destination folder is outside the selected vault")
        if path.exists() or read_optional(sidecar_path(root, target_id)) is not None:
            raise HTTPException(409, "The new note already exists")
        # The ID is immutable; the standard page save flow can rename the file later.
        return Document(
            target_id, path, {"id": target_id, "title": request.title}, "", None, None, None
        )
    target = documents.get(target_id)
    if target is None:
        raise HTTPException(404, "The destination note no longer exists")
    if target.metadata.get("is_dashboard") or moved & anchors(target.body):
        raise HTTPException(409, "Destination headings or block IDs conflict with the selection")
    return target


def _moving_reference(
    root: Path,
    source: Document,
    target: Document,
    retarget: Callable[[str], str | None],
    resolve: Callable[[str, str], str | None],
) -> Callable[[str], str | None]:
    def move_reference(raw: str) -> str | None:
        changed = retarget(raw)
        if changed is not None:
            return changed
        base, marker, section = raw.partition("#")
        if not base or re.match(r"^[a-z][\w+.-]*:", base, re.I) or base.startswith("/"):
            return None
        decoded = unquote(base)
        # Folder-relative note and media links must still work from the destination folder.
        if "/" not in decoded and not Path(decoded).suffix:
            return None
        linked_page = resolve(base, source.id)
        if linked_page:
            return f"{linked_page}{marker}{section}"
        candidate = (source.path.parent / decoded).resolve()
        if not candidate.is_relative_to(root):
            raise HTTPException(409, "A moved link points outside this vault")
        if candidate.is_file() and source.path.parent != target.path.parent:
            relative = candidate.relative_to(root).as_posix()
            served = (
                quote(relative, safe="/")
                if relative.startswith("Assets/")
                else f"/api/vault/raw/{quote(relative, safe='/')}"
            )
            return f"{served}{marker}{section}"
        return None

    return move_reference


def build_plan(root: Path, request: ComposerRequest, dependencies: ComposerDependencies) -> Plan:
    root = root.resolve()
    dependencies.validate_access()
    documents = inventory(root, dependencies)
    source = documents.get(request.source_id)
    if source is None:
        raise HTTPException(404, "The source note no longer exists")
    if source.metadata.get("is_dashboard"):
        raise HTTPException(409, "Composer requires a Markdown note")
    start, end = select(source.body, request)
    selected = source.body[start:end]
    remaining = source.body[:start] + source.body[end:]
    moved = anchors(selected)
    if moved & anchors(remaining):
        raise HTTPException(
            409, "Duplicate headings or block IDs make the selected links ambiguous"
        )
    target_id = request.target_id or str(uuid.uuid4())
    if target_id == source.id:
        raise HTTPException(422, "Choose a different destination note")
    normalized = request.model_copy(update={"target_id": target_id, "title": request.title.strip()})
    target = _prepare_target(root, normalized, target_id, documents, moved)
    resolve = _reference_resolver(documents, root, source.id)
    whole = request.selection == "note"
    retarget = _retargeter(
        source.id, target.id, moved, whole, source.id, resolve, dependencies.local_prefixes
    )

    move_reference = _moving_reference(root, source, target, retarget, resolve)

    selected, retained_definitions, destination = preserve_reference_context(
        source.body, start, end, target.body
    )
    migrated, _ = rewrite_links(selected, move_reference)
    # Preserve original note identity, metadata, and relation references via an ordinary portable
    # embed.
    source_after = (
        source.body[:start].rstrip() + f"\n\n![[{target.id}]]\n\n" + source.body[end:].lstrip()
    )
    if request.selection == "heading":
        source_after = (
            source.body[:start].rstrip()
            + f"\n\n![[{target.id}#{request.heading.strip()}]]\n\n"
            + source.body[end:].lstrip()
        )
    if retained_definitions:
        source_after = retained_definitions + "\n\n" + source_after.lstrip()
    outputs = {
        source.id: source_after.strip() + "\n",
        target.id: (destination.rstrip() + "\n\n" + migrated.strip()).lstrip() + "\n",
    }
    rewritten_links = 0
    for page in documents.values():
        text = outputs.get(page.id, page.body)
        # Remaining local source links can still move; destination's local links belong to itself.
        after, count = rewrite_links(
            text,
            _retargeter(
                source.id, target.id, moved, whole, page.id, resolve, dependencies.local_prefixes
            ),
        )
        if count:
            outputs[page.id] = after
            rewritten_links += count
    for body in dependencies.unsupported_bodies():
        _, count = rewrite_links(
            body,
            _retargeter(
                source.id, target.id, moved, whole, "", resolve, dependencies.local_prefixes
            ),
        )
        if count:
            raise HTTPException(
                409, "A dashboard links to this selection; update that link before composing notes"
            )
    documents[target.id] = target
    changes = [
        ComposerChange(
            id=page_id,
            title=documents[page_id].title,
            before=documents[page_id].body,
            after=after,
            etag=documents[page_id].etag,
            created=documents[page_id].raw is None,
        )
        for page_id, after in sorted(outputs.items())
    ]
    if len(changes) > 200:
        raise HTTPException(409, "Too many notes need link updates for one Composer operation")
    dependencies.validate_pages([change.id for change in changes])
    fingerprint = {
        "root": str(root),
        "request": normalized.model_dump(),
        "changes": [c.model_dump() for c in changes],
        "originals": {
            c.id: hashlib.sha256(
                (documents[c.id].raw or b"") + b"\0" + (documents[c.id].sidecar or b"")
            ).hexdigest()
            for c in changes
        },
    }
    token = hashlib.sha256(json.dumps(fingerprint, sort_keys=True).encode()).hexdigest()
    return Plan(
        ComposerPreview(
            request=normalized, token=token, changes=changes, rewritten_links=rewritten_links
        ),
        documents,
    )


def _verify_original(root: Path, document: Document) -> None:
    if (
        file_etag(document.path) != document.etag
        or read_optional(document.path) != document.raw
        or read_optional(sidecar_path(root, document.id)) != document.sidecar
    ):
        raise HTTPException(409, "A note or its metadata changed; request a fresh preview")


def _backup(root: Path, document: Document) -> None:
    if document.raw is None:
        return
    history = HistoryRepository(root)
    if not history.page_root(document.id).resolve().is_relative_to(root):
        raise HTTPException(409, "History storage must remain inside the selected vault")
    before = set(history.page_root(document.id).glob("*.md"))
    history.create_file_version(document.id, document.path, force=True)
    versions = set(history.page_root(document.id).glob("*.md")) - before
    if len(versions) != 1:
        raise OSError("Could not retain a note version")
    version = versions.pop()
    if version.read_bytes() != document.raw:
        raise OSError("The retained version differs from the preview")
    if document.sidecar is not None:
        safe_write_bytes(version.with_suffix(".metadata.json"), document.sidecar)


def _restore_written_documents(root: Path, written: list[Document]) -> list[str]:
    failures: list[str] = []
    for document in reversed(written):
        try:
            for path, content in (
                (document.path, document.raw),
                (sidecar_path(root, document.id), document.sidecar),
            ):
                if content is None:
                    path.unlink(missing_ok=True)
                else:
                    safe_write_bytes(path, content)
        except OSError:
            failures.append(document.id)
    return failures


async def apply_plan(
    root: Path, request: ComposerApplyRequest, dependencies: ComposerDependencies
) -> ComposerResult:
    root = root.resolve()
    initial = build_plan(root, request.request, dependencies)
    ids = sorted(change.id for change in initial.preview.changes)
    async with AsyncExitStack() as stack:
        for page_id in ids:
            await stack.enter_async_context(await get_page_write_lock(page_id))
        plan = build_plan(root, request.request, dependencies)
        if plan.preview.token != request.token or sorted(c.id for c in plan.preview.changes) != ids:
            raise HTTPException(
                409, "Notes or links changed after the preview; review a fresh preview"
            )
        changes = plan.preview.changes
        for change in changes:
            _verify_original(root, plan.documents[change.id])
        try:
            for change in changes:
                _backup(root, plan.documents[change.id])
        except OSError as error:
            raise HTTPException(
                503, "History could not be retained; no notes were changed"
            ) from error
        # Source is last: until it is saved the original selected Markdown remains available.
        ordered = sorted(
            changes, key=lambda c: (c.id == request.request.source_id, not c.created, c.id)
        )
        written: list[Document] = []
        try:
            for change in ordered:
                dependencies.validate_access()
                document = plan.documents[change.id]
                _verify_original(root, document)
                written.append(document)  # The writer may persist a sidecar before failing.
                dependencies.save(document.path, deepcopy(document.metadata), change.after)
        except Exception as error:
            failures = _restore_written_documents(root, written)
            if failures:
                log.error("Composer rollback requires recovery for pages %s", failures)
                raise HTTPException(
                    500,
                    {
                        "message": (
                            "Some notes could not be restored; recover their retained history"
                        ),
                        "page_ids": failures,
                    },
                ) from error
            if isinstance(error, HTTPException):
                raise
            raise HTTPException(
                503, "The operation failed; all affected notes were restored"
            ) from error
        for change in changes:
            document = plan.documents[change.id]
            try:
                dependencies.refresh(document.path, document.metadata, change.after)
            except Exception:
                log.exception(
                    "Composer saved page %s but its derived index needs refreshing", change.id
                )
            change.etag = file_etag(document.path)
        return ComposerResult(
            source_id=request.request.source_id,
            target_id=plan.preview.request.target_id or "",
            changes=changes,
        )
