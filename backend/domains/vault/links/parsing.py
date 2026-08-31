"""Pure parsing operations for wikilinks and unlinked mentions."""

from __future__ import annotations

import re
import urllib.parse
from collections.abc import Callable
from pathlib import Path

from backend.domains.vault.pages.foundation_values import PageMetadata
from backend.domains.vault.registry.records import is_object_list

WIKILINK_RE = re.compile(r"!?\[\[([^\]|]+(?:#[^\]|]+)?)(?:\|.*?)?\]\]")
MDLINK_RE = re.compile(r"\[.*?\]\((.*?)\)")
TOKEN_SPLIT_RE = re.compile(r"[^\wÀ-ÿ]+", re.UNICODE)
RELATION_WIKILINK_RE = re.compile(
    r"^\s*\[\[(?P<title>[^\]\|]*?)\s*\|\s*(?P<rid>[^\]\|]+?)\s*\]\]\s*$"
)
TITLE_ONLY_WIKILINK_RE = re.compile(r"^\s*\[\[\s*(?P<title>[^\]\|]+?)\s*\]\]\s*$")


def normalize_ref(raw_ref: str) -> str:
    text = str(raw_ref or "").strip()
    if not text:
        return ""
    try:
        text = urllib.parse.unquote(text)
    except Exception:
        pass
    base = text.split("#", 1)[0].strip()
    match = re.search(
        r"(?:https?://[^/]+)?/(?:api/)?vault/(?:page|pages)/([^/?#]+)",
        base,
        re.IGNORECASE,
    )
    if match and match.group(1):
        try:
            base = urllib.parse.unquote(match.group(1).strip())
        except Exception:
            base = match.group(1).strip()
    return base


def _mark_ref(
    ref: str,
    kind: str,
    refs: set[str],
    kinds: dict[str, str],
) -> None:
    if not ref:
        return
    refs.add(ref)
    if kinds.get(ref) != "relation":
        kinds[ref] = kind


def _add_metadata_ref(
    value: object,
    kind: str,
    refs: set[str],
    kinds: dict[str, str],
) -> None:
    if value is None:
        return
    if is_object_list(value):
        for item in value:
            _add_metadata_ref(item, kind, refs, kinds)
        return
    text = str(value).strip()
    if not text:
        return
    relation = RELATION_WIKILINK_RE.match(text)
    if relation:
        _add_metadata_ref(relation.group("rid"), kind, refs, kinds)
        if relation.group("title"):
            _add_metadata_ref(relation.group("title"), kind, refs, kinds)
        return
    title_only = TITLE_ONLY_WIKILINK_RE.match(text)
    if title_only:
        _add_metadata_ref(title_only.group("title"), kind, refs, kinds)
        return
    normalized = normalize_ref(text)
    if normalized:
        _mark_ref(normalized, kind, refs, kinds)
        _mark_ref(normalized.lower(), kind, refs, kinds)


def extract_outlinks_with_kinds(
    metadata: PageMetadata,
    body: str,
) -> tuple[set[str], dict[str, str]]:
    refs: set[str] = set()
    kinds: dict[str, str] = {}

    for value in metadata.values():
        if isinstance(value, (str, list)):
            _add_metadata_ref(value, "relation", refs, kinds)
    if body:
        for raw in WIKILINK_RE.findall(body):
            base = str(raw or "").split("#", 1)[0].strip()
            if base:
                _mark_ref(base, "link", refs, kinds)
                _mark_ref(base.lower(), "link", refs, kinds)
        for raw in MDLINK_RE.findall(body):
            normalized = normalize_ref(raw)
            if normalized:
                _mark_ref(normalized, "link", refs, kinds)
                _mark_ref(normalized.lower(), "link", refs, kinds)
    return refs, kinds


def extract_outlinks(metadata: PageMetadata, body: str) -> set[str]:
    refs, _ = extract_outlinks_with_kinds(metadata, body)
    return refs


def strip_existing_links(text: str) -> str:
    source = str(text or "")
    source = re.sub(r"```[\s\S]*?```", " ", source)
    source = re.sub(r"!?\[\[[^\]]+\]\]", " ", source)
    return re.sub(r"\[[^\]]*\]\([^)]+\)", " ", source)


def tokenize_body(body: str) -> frozenset[str]:
    if not body:
        return frozenset()
    tokens = TOKEN_SPLIT_RE.split(strip_existing_links(body).lower())
    return frozenset(token for token in tokens if len(token) >= 2)


def resolve_page_id(metadata: PageMetadata, file_path: Path) -> str:
    return str(metadata.get("id") or metadata.get("migration_id") or file_path.stem).strip()


def build_unlinked_mention_regex(target_title: str) -> re.Pattern[str] | None:
    safe_title = str(target_title or "").strip()
    if len(safe_title) < 2:
        return None
    return re.compile(rf"(?<!\w){re.escape(safe_title)}(?!\w)", re.IGNORECASE)


def count_unlinked_mentions(text: str, target_title: str) -> int:
    pattern = build_unlinked_mention_regex(target_title)
    if not pattern:
        return 0
    return len(list(pattern.finditer(strip_existing_links(text))))


def first_unlinked_mention_snippet(
    text: str,
    target_title: str,
    radius: int = 48,
) -> str:
    pattern = build_unlinked_mention_regex(target_title)
    if not pattern:
        return ""
    sanitized = strip_existing_links(text)
    match = pattern.search(sanitized)
    if not match:
        return ""
    start = max(0, match.start() - radius)
    end = min(len(sanitized), match.end() + radius)
    snippet = sanitized[start:end].replace("\n", " ").strip()
    return re.sub(r"\s+", " ", snippet)


def link_mentions_in_plain_segments(
    body: str,
    target_title: str,
    target_id: str,
    build_browser_path: Callable[[str, str], str],
) -> tuple[str, int]:
    pattern = build_unlinked_mention_regex(target_title)
    if not pattern:
        return str(body or ""), 0
    source = str(body or "")
    link_token = build_browser_path(
        "knowledge",
        f"page/{urllib.parse.quote(str(target_id or '').strip())}",
    )
    existing_link_pattern = re.compile(r"!?\[\[[^\]]+\]\]|\[[^\]]*\]\([^)]+\)")
    parts: list[str] = []
    last_index = 0
    replacements = 0

    def replace_title(match: re.Match[str]) -> str:
        nonlocal replacements
        replacements += 1
        return f"[{match.group(0)}]({link_token})"

    for match in existing_link_pattern.finditer(source):
        parts.append(pattern.sub(replace_title, source[last_index : match.start()]))
        parts.append(match.group(0))
        last_index = match.end()
    parts.append(pattern.sub(replace_title, source[last_index:]))
    return "".join(parts), replacements


__all__ = [
    "MDLINK_RE",
    "TOKEN_SPLIT_RE",
    "WIKILINK_RE",
    "build_unlinked_mention_regex",
    "count_unlinked_mentions",
    "extract_outlinks",
    "extract_outlinks_with_kinds",
    "first_unlinked_mention_snippet",
    "link_mentions_in_plain_segments",
    "normalize_ref",
    "resolve_page_id",
    "strip_existing_links",
    "tokenize_body",
]
