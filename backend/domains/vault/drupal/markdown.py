"""Gnosi Markdown preprocessing for Drupal rich-text fields."""

from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from backend.domains.vault.drupal.core import Metadata
from backend.domains.vault.pages.state import PageState


EMBED_RE = re.compile(r"!\[\[([^\]]+)\]\]")
WIKILINK_RE = re.compile(r"\[\[([^\]]+)\]\]")
UUID_RE = re.compile(r"^[0-9a-fA-F-]{32,36}$")


@dataclass(frozen=True)
class DrupalMarkdownDependencies:
    active_vault_path: Callable[[], Path | None]
    page_state: PageState
    find_page: Callable[[str], Path | None]
    parse_frontmatter: Callable[[str, Path], tuple[Metadata, str]]
    markdown_to_html: Callable[[str], str]


def resolve_title_to_id(
    title: str,
    dependencies: DrupalMarkdownDependencies,
) -> str | None:
    """Resolve one page title through the canonical in-memory page index."""
    normalized = str(title or "").strip().lower()
    if not normalized:
        return None
    try:
        vault_path = dependencies.active_vault_path()
        if not vault_path:
            return None
        with dependencies.page_state.index_lock:
            entries = list(dependencies.page_state.index_entries.get(str(vault_path), {}).values())
        for entry in entries:
            if str(entry.get("title") or "").strip().lower() == normalized:
                page_id = entry.get("id")
                return str(page_id) if page_id else None
    except Exception:
        return None
    return None


def wikilink_url(
    target: str,
    cache: dict[str, str | None],
    dependencies: DrupalMarkdownDependencies,
) -> str | None:
    """Resolve a wikilink target to an already-synchronized Drupal URL."""
    base = target.split("#", 1)[0].strip()
    if not base:
        return None
    if base in cache:
        return cache[base]
    url: str | None = None
    page_id = base if UUID_RE.match(base) else resolve_title_to_id(base, dependencies)
    if page_id:
        try:
            file_path = dependencies.find_page(page_id)
            if file_path and file_path.exists():
                metadata, _body = dependencies.parse_frontmatter(
                    file_path.read_text(encoding="utf-8"),
                    file_path,
                )
                url = str(metadata.get("drupal_url") or "").strip() or None
        except Exception:
            url = None
    cache[base] = url
    return url


def preprocess_markdown(
    markdown: str,
    dependencies: DrupalMarkdownDependencies,
    *,
    cache: dict[str, str | None] | None = None,
) -> str:
    """Strip embeds and resolve portable wikilinks before HTML conversion."""
    if not markdown:
        return markdown
    resolved_cache = cache if cache is not None else {}
    without_embeds = EMBED_RE.sub("", markdown)

    def _replace(match: re.Match[str]) -> str:
        inner = match.group(1)
        if "|" in inner:
            target, display = inner.split("|", 1)
            display = display.strip()
        else:
            target = inner
            display = inner.split("#", 1)[0].strip()
        try:
            url = wikilink_url(target.strip(), resolved_cache, dependencies)
        except Exception:
            url = None
        return f"[{display}]({url})" if url else display

    return WIKILINK_RE.sub(_replace, without_embeds)


def markdown_to_html(
    markdown: str,
    cache: dict[str, str | None],
    dependencies: DrupalMarkdownDependencies,
) -> str:
    """Convert preprocessed Gnosi Markdown to Drupal full HTML."""
    return dependencies.markdown_to_html(
        preprocess_markdown(markdown or "", dependencies, cache=cache)
    )


__all__ = [
    "DrupalMarkdownDependencies",
    "markdown_to_html",
    "preprocess_markdown",
    "resolve_title_to_id",
    "wikilink_url",
]
