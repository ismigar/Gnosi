"""Canonical English article routes projected from selected Gnosi content."""
from __future__ import annotations

from dataclasses import dataclass, field
import hashlib
import json
from pathlib import Path
import re
from typing import TYPE_CHECKING, cast
from urllib.parse import urlsplit

from fastapi import HTTPException

from pydantic import JsonValue

from .models import PublicRecord, SiteConfig, safe_path

if TYPE_CHECKING:
    from .exporter import Note


def table_path(metadata: dict[str, JsonValue], table: dict[str, JsonValue], site: SiteConfig) -> str | None:
    """The registered URL field owns a native record's canonical address."""
    from backend.services.field_resolver import get_meta_value, resolve_property
    from .exporter import property_definitions
    schema = {"properties": property_definitions(table)}
    if resolve_property(schema, "URL") is None:
        return None
    value = get_meta_value(metadata, schema, "URL")
    if value is None or value == "":
        return None
    if not isinstance(value, str):
        raise HTTPException(422, "The URL field must contain a content URL")
    try:
        url = urlsplit(value)
        if url.scheme or url.netloc:
            if url.scheme not in {"http", "https"} or url.hostname != urlsplit(site.origin).hostname:
                return None  # External content links retain their card semantics.
            if url.username or url.password:
                raise ValueError("Credentials")
        if not url.scheme and not url.netloc and not url.path.startswith("/"):
            return None
        if url.query or url.fragment:
            raise ValueError("A canonical URL cannot contain a query or fragment")
        return safe_path(url.path)
    except ValueError:
        raise HTTPException(422, "The URL field must contain a plain canonical content URL") from None


def validate_table_paths(site: SiteConfig, notes: list[Note], data: dict[str, JsonValue], vault: Path) -> dict[str, str]:
    """Reserve declared URLs even while records are private or withdrawn."""
    from .exporter import note_table
    from .translations import public_id
    owners: dict[str, str] = {}
    public_owners: dict[str, str] = {}
    for note in notes:
        table = note_table(note, data, vault)
        path = table_path(note.metadata, table, site)
        if path is None:
            continue
        identity = str(note.metadata["id"])
        if path in owners and owners[path] != identity:
            raise HTTPException(422, "Two table records declare the same URL; correct their URL fields before publishing")
        owners[path] = identity
        public_owners[path] = public_id(note.metadata, site)
    return public_owners


def validate_article_url(record: PublicRecord, metadata: dict[str, JsonValue], table: dict[str, JsonValue], site: SiteConfig) -> None:
    if not site.legacy_pilot or record.language not in {"en", "en-gb"} or record.presentation.get("kind") != "article":
        return
    declared = table_path(metadata, table, site)
    if declared and re.fullmatch(r"/en/[^/]+", declared) is None:
        raise HTTPException(422, "Correct the article URL field to /en/title-slug before publishing")


@dataclass
class ArticleRoutes:
    site: SiteConfig
    public: dict[tuple[str, str], PublicRecord]
    previous_records: list[dict[str, JsonValue]]
    paths: dict[tuple[str, str], str]
    baseline_path: Path
    previous_withdrawn: list[str]
    declared_owners: dict[str, str]
    obsolete_paths: set[str] = field(default_factory=set)

    def project(self) -> dict[str, str]:
        """Give English articles descriptive routes without publishing former URLs."""
        from .exporter import slug
        if not self.site.legacy_pilot:
            return {}

        def canonical_path(path: str) -> bool:
            return re.fullmatch(r"/en/[^/]+", path) is not None

        baseline_path = self.baseline_path
        baseline = json.loads(baseline_path.read_text()) if baseline_path.is_file() else {}
        imported = {(str(node["uuid"]), str(node["lang"])): str(node["url"])
                    for node in baseline.get("data", {}).get("nodes", [])}
        self.obsolete_paths = {str(node["url"]) for node in baseline.get("data", {}).get("nodes", [])
                               if node.get("lang") in {"en", "en-gb"} and node.get("type") == "article"
                               and not canonical_path(str(node["url"]))}
        previous_english = {path for path in self.previous_withdrawn if canonical_path(path)} | {str(record["path"]) for record in self.previous_records
                            if record.get("language") in {"en", "en-gb"}
                            and isinstance(record.get("presentation"), dict)
                            and cast(dict[str, JsonValue], record["presentation"]).get("kind") == "article"}
        self.obsolete_paths |= {path for path in previous_english if not canonical_path(path)}
        replacements: dict[str, str] = {}
        owners = {path: key[0] for key, path in self.paths.items() if key[1] in {"en", "en-gb"} and canonical_path(path)}
        owners.update(self.declared_owners)
        occupied = (set(self.declared_owners) | {record.path for record in self.public.values()} | {page.path for page in self.site.pages if page.enabled}
                    | {path for (_identity, language), path in self.paths.items() if language in {"en", "en-gb"} and canonical_path(path)})
        for key, record in sorted(self.public.items()):
            english_article = record.language in {"en", "en-gb"} and record.presentation.get("kind") == "article"
            origins = {record.path, imported.get(key, ""), self.paths.get(key, "")}
            origins = {path for path in origins if owners.get(path, record.id) == record.id}
            owner = owners.get(record.path)
            if english_article and (not canonical_path(record.path) or (owner is not None and owner != record.id)):
                previous = self.paths.get(key, "")
                if owner is None or owner == record.id:
                    occupied.discard(record.path)
                if canonical_path(previous) and owners.get(previous, record.id) == record.id:
                    record.path = previous
                else:
                    base = "/en/" + slug(record.title)
                    record.path = base
                    suffix = hashlib.sha256(record.id.encode()).hexdigest()[:8]
                    attempt = 0
                    while record.path in occupied:
                        attempt += 1
                        record.path = base + "-" + suffix + ("-" + str(attempt) if attempt > 1 else "")
                occupied.add(record.path)
            replacements.update({origin: record.path for origin in origins if origin and origin != record.path})
        self.obsolete_paths.update(replacements)
        english_paths = {record.path for record in self.public.values()
                         if record.language in {"en", "en-gb"} and record.presentation.get("kind") == "article"}
        while True:
            aliases = {origin: replacements.get(target, replacements.get(target.rstrip("/"), target.rstrip("/")))
                       for origin, target in self.site.redirects.items()
                       if target in replacements or target.rstrip("/") in replacements or target.rstrip("/") in english_paths}
            obsolete = {origin for origin, target in self.site.redirects.items()
                        if target in self.obsolete_paths or target.rstrip("/") in self.obsolete_paths or target.rstrip("/") in english_paths | previous_english}
            if aliases.items() <= replacements.items() and obsolete <= self.obsolete_paths:
                break
            replacements.update(aliases)
            self.obsolete_paths.update(obsolete)
        return replacements
