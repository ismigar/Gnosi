"""Public language and translation identities from Gnosi's native metadata."""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from fastapi import HTTPException
from pydantic import JsonValue

from backend.services.translation_helpers import canonicalize_id, detect_record_lang_raw, normalize_lang_code

from .models import SiteConfig


def _text(value: JsonValue) -> str:
    if isinstance(value, list):
        return _text(value[0]) if value else ""
    if isinstance(value, dict):
        return _text(value.get("id", value.get("value", value.get("name", value.get("label")))))
    return value.strip() if isinstance(value, str) else ""


def public_id(metadata: dict[str, JsonValue], site: SiteConfig) -> str:
    identity = str(metadata["id"])
    return str(metadata.get("drupal_uuid") or identity) if site.legacy_pilot else identity


def _native_origin(metadata: dict[str, JsonValue]) -> str:
    return _text(metadata.get("translation_origin_id")) if _text(metadata.get("translation_lang")) else ""


def _language_candidates(raw: str, site: SiteConfig) -> list[str]:
    value = raw.strip().lower().replace("_", "-")
    if value in site.languages:
        return [value]
    code = normalize_lang_code(value)
    if re.fullmatch(r"[a-z]{2,3}-[a-z0-9-]+", value):
        return []
    if code in site.languages:
        return [code]
    return [language for language in site.languages if code and normalize_lang_code(language) == code]


def configured_language(raw: str, site: SiteConfig) -> str:
    """Keep exact regions and resolve a bare language only without ambiguity."""
    matches = _language_candidates(raw, site)
    if len(matches) > 1:
        raise HTTPException(422, "A selected content language matches multiple configured regional variants")
    if not matches:
        raise HTTPException(422, "A selected content language is not configured for this website")
    return matches[0]


@dataclass
class PublicTranslations:
    site: SiteConfig
    metadata: list[dict[str, JsonValue]]
    by_id: dict[str, dict[str, JsonValue]] = field(init=False, default_factory=dict)
    source_hints: dict[str, list[str]] = field(init=False, default_factory=dict)

    def __post_init__(self) -> None:
        for item in self.metadata:
            identity = canonicalize_id(item["id"])
            if identity in self.by_id:
                raise HTTPException(409, "Resolve canonically duplicate page identities before publishing")
            self.by_id[identity] = item
            origin = _native_origin(item)
            source = _text(item.get("translation_source_lang"))
            if origin and source:
                self.source_hints.setdefault(canonicalize_id(origin), []).append(source)

    def _language(self, metadata: dict[str, JsonValue]) -> str:
        explicit = _text(metadata.get("translation_lang")) or detect_record_lang_raw(metadata)
        if explicit:
            return configured_language(explicit, self.site)
        hints = self.source_hints.get(canonicalize_id(metadata["id"]), [])
        inferred = {configured_language(hint, self.site) for hint in hints}
        if len(inferred) > 1:
            raise HTTPException(422, "Native translations disagree about the original page language")
        return next(iter(inferred), self.site.default_language)

    def language(self, metadata: dict[str, JsonValue], *, required: bool = True) -> str:
        try:
            return self._language(metadata)
        except HTTPException:
            if required:
                raise
            return ""

    def private_languages(self, metadata: dict[str, JsonValue]) -> set[str]:
        """Do not withdraw unrelated baseline languages for an unconfigured one."""
        explicit = _text(metadata.get("translation_lang")) or detect_record_lang_raw(metadata)
        return set(_language_candidates(explicit, self.site)) if explicit else {self._language(metadata)}

    def _original(self, metadata: dict[str, JsonValue]) -> dict[str, JsonValue]:
        current = metadata
        visited: set[str] = set()
        while origin := _native_origin(current):
            identity = canonicalize_id(current["id"])
            if identity in visited:
                raise HTTPException(409, "Native translation origins contain a cycle")
            visited.add(identity)
            found = self.by_id.get(canonicalize_id(origin))
            if found is None:
                raise HTTPException(409, "A native translation origin is unavailable; check OneDrive before publishing")
            current = found
        return current

    def group_id(self, metadata: dict[str, JsonValue]) -> str:
        original = self._original(metadata)
        legacy = _text(original.get("Original")) or _text(original.get("translation_id"))
        if legacy:
            found = self.by_id.get(canonicalize_id(legacy))
            return public_id(self._original(found), self.site) if found else legacy
        return public_id(original, self.site)
