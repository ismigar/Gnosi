"""Bounded bookmark API and portable journal contracts."""
from __future__ import annotations

import re
import time
from typing import Annotated, Literal
from urllib.parse import unquote, urlsplit

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StrictBool, StringConstraints, model_validator

BookmarkId = Annotated[str, StringConstraints(strict=True, min_length=1, max_length=160, pattern=r"^[A-Za-z0-9_-]+$")]
SortMode = Literal["manual", "alpha-asc", "alpha-desc", "recent", "oldest"]
VAULT_ROUTE_ROOTS = frozenset({"knowledge", "graph", "calendar", "reader", "mail", "automations",
                              "social", "media", "contacts", "planning", "resources", "notebooks"})


def validate_page_identifier(value: str) -> str:
    """Page IDs may be indexed filenames/titles, but never filesystem paths."""
    if not value.strip() or len(value) > 2000 or value in {".", ".."}:
        raise ValueError("Invalid page identifier")
    if any(char in value for char in "/\\") or any(ord(char) < 32 or ord(char) == 127 for char in value):
        raise ValueError("Page identifiers cannot contain paths or control characters")
    return value


PageIdentifier = Annotated[str, StringConstraints(strict=True, min_length=1, max_length=2000),
                           AfterValidator(validate_page_identifier)]


def _fully_decoded(value: str) -> str:
    """Expose nested URL escaping before checking navigation boundaries."""
    for _ in range(10):
        decoded = unquote(value, errors="strict")
        if decoded == value:
            return value
        value = decoded
    raise ValueError("Excessively nested URL escaping")


def validate_vault_route(target: str) -> str:
    """Validate a vault-relative app route while retaining its exact encoding."""
    if not target or len(target) > 2000 or target != target.strip():
        raise ValueError("Invalid vault-relative route")
    decoded = _fully_decoded(target)
    if "\\" in decoded or any(ord(char) < 32 or ord(char) == 127 for char in decoded):
        raise ValueError("Route contains backslashes or control characters")
    parsed = urlsplit(target)
    if parsed.scheme or parsed.netloc or not parsed.path.startswith("/"):
        raise ValueError("Routes must be relative to the selected vault")
    root = parsed.path.split("/")[1]
    if root not in VAULT_ROUTE_ROOTS:
        raise ValueError("Unknown vault application route")
    path = _fully_decoded(parsed.path)
    if any(segment in {".", ".."} for segment in path.split("/")) or "//" in path:
        raise ValueError("Route path traversal is forbidden")
    return target


def plain_page_route_id(target: str) -> str | None:
    """Unify whole-page routes with stars; specific views retain their route."""
    match = re.fullmatch(r"/knowledge/(?:page|dashboard)/([^/?#]+)/?", target)
    if match is None:
        return None
    try:
        return validate_page_identifier(unquote(match.group(1), errors="strict"))
    except ValueError:
        return None


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class BookmarkEntry(StrictModel):
    id: BookmarkId
    label: Annotated[str, StringConstraints(strict=True, min_length=1, max_length=200)]
    group: Annotated[str, StringConstraints(strict=True, max_length=100)] = ""
    kind: Literal["page", "section", "search", "graph", "url", "route"]
    target: Annotated[str, StringConstraints(strict=True, min_length=1, max_length=2000)]

    @model_validator(mode="after")
    def safe_target(self) -> BookmarkEntry:
        if not self.label.strip() or not self.target.strip():
            raise ValueError("Bookmark label and target must not be blank")
        if any(ord(char) < 32 or ord(char) == 127 for char in self.target):
            raise ValueError("Bookmark target contains control characters")
        if self.kind == "page":
            validate_page_identifier(self.target)
        if self.kind == "section":
            page_id, separator, fragment = self.target.partition("#")
            validate_page_identifier(page_id)
            if any(char in page_id for char in "[]|"):
                raise ValueError("Section page identifiers cannot contain wiki delimiters")
            if not separator or not fragment.strip():
                raise ValueError("Section bookmarks require a heading or block")
            if any(char in fragment for char in "[]|"):
                raise ValueError("Section bookmarks cannot contain wiki delimiters")
        if self.kind == "url":
            parsed = urlsplit(self.target)
            if parsed.scheme.lower() not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password or "\\" in self.target:
                raise ValueError("Only absolute HTTP(S) URLs without credentials are allowed")
        if self.kind == "graph":
            parsed = urlsplit(self.target)
            decoded = unquote(parsed.path)
            if parsed.scheme or parsed.netloc or "\\" in self.target or not re.fullmatch(r"(?:/@[a-z0-9-]+)?/graph/?", decoded):
                raise ValueError("Invalid local graph route")
        if self.kind == "route":
            validate_vault_route(self.target)
            route_page_id = plain_page_route_id(self.target)
            if route_page_id is not None:
                self.kind = "page"
                self.target = route_page_id
        return self


class BookmarkItem(BookmarkEntry):
    created_at: float


class BookmarkCollection(StrictModel):
    entries: list[BookmarkItem]
    sort_mode: SortMode = "manual"


class BookmarkImport(StrictModel):
    entries: list[BookmarkEntry] = Field(max_length=500)
    sort_mode: SortMode | None = None
    page_order: list[PageIdentifier] | None = Field(default=None, max_length=10000)


class BookmarkOrder(StrictModel):
    ids: list[BookmarkId] = Field(max_length=10000)


class BookmarkSort(StrictModel):
    mode: SortMode


class BookmarkPage(StrictModel):
    label: Annotated[str, StringConstraints(strict=True, min_length=1, max_length=200)]
    enabled: StrictBool

    @model_validator(mode="after")
    def nonblank_label(self) -> BookmarkPage:
        if not self.label.strip():
            raise ValueError("Page label must not be blank")
        return self


class BookmarkRoute(BookmarkPage):
    target: Annotated[str, StringConstraints(strict=True, min_length=1, max_length=2000)]

    @model_validator(mode="after")
    def safe_route_target(self) -> BookmarkRoute:
        validate_vault_route(self.target)
        return self


class MigrationItem(StrictModel):
    source: Annotated[str, StringConstraints(strict=True, min_length=1, max_length=2100)]
    entry: BookmarkEntry | None = None
    created_at: float | None = Field(default=None, ge=0, allow_inf_nan=False)


class JournalEvent(StrictModel):
    version: Literal[1] = 1
    clock: int = Field(ge=1)
    id: Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{32}$")]
    created_at: float = Field(default_factory=time.time, ge=0, allow_inf_nan=False)
    entries: list[BookmarkEntry] = Field(default_factory=list, max_length=10000)
    deleted: list[BookmarkId] = Field(default_factory=list, max_length=10000)
    legacy_page_tombstones: list[PageIdentifier] = Field(default_factory=list, max_length=10000)
    legacy_item_tombstones: list[Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{64}$")]] = Field(default_factory=list, max_length=10000)
    migrations: list[MigrationItem] = Field(default_factory=list, max_length=10000)
    order: list[BookmarkId] | None = Field(default=None, max_length=10000)
    sort_mode: SortMode | None = None
    preference: Literal["user", "legacy"] | None = None
