"""Project authored links onto current public routes without changing their sources."""
from __future__ import annotations

from typing import TYPE_CHECKING, cast
from urllib.parse import urlsplit

from bs4 import BeautifulSoup
from markdown_it import MarkdownIt
from markdown_it.token import Token
from fastapi import HTTPException

from .models import PublicRecord, SiteConfig

if TYPE_CHECKING:
    from .exporter import AssetExporter, Note


def remap_url(value: str, paths: dict[str, str], origin: str) -> str:
    url = urlsplit(value)
    if url.scheme not in {"", "http", "https"} or (url.netloc and url.netloc != urlsplit(origin).netloc):
        return value
    target = paths.get(url.path, paths.get(url.path.rstrip("/")))
    if target is None:
        return value
    return target + ("?" + url.query if url.query else "") + ("#" + url.fragment if url.fragment else "")


def remap_html(value: str, paths: dict[str, str], origin: str) -> str:
    body = BeautifulSoup(value, "html.parser")
    changed = False
    for link in body.find_all("a", href=True):
        href = str(link["href"])
        mapped = remap_url(href, paths, origin)
        if mapped != href:
            link["href"] = mapped
            changed = True
    return str(body) if changed else value


def project_links(site: SiteConfig, records: list[PublicRecord], paths: dict[str, str]) -> None:
    if not paths:
        return
    for link in [*site.navigation, *site.header_actions, *site.footer, *site.social_links, *(site.footer_bottom_links or [])]:
        link.href = remap_url(link.href, paths, site.origin)
    for form in site.forms:
        form.privacy_url = remap_url(form.privacy_url, paths, site.origin)
        form.privacy_urls = {language: remap_url(value, paths, site.origin) for language, value in form.privacy_urls.items()}
    for _, block in site.editorial_blocks(enabled_only=True):
        block.href = remap_url(block.href, paths, site.origin)
        for link in [*(block.actions or []), *block.links]:
            link.href = remap_url(link.href, paths, site.origin)
        if block.body_format == "html":
            block.body = remap_html(block.body, paths, site.origin)
        else:
            parser = MarkdownIt("commonmark", {"html": False})
            tokens = parser.parse(block.body)
            changed = False
            for token in tokens:
                for child in token.children or []:
                    if child.type == "link_open":
                        href = str(child.attrGet("href") or "")
                        mapped = remap_url(href, paths, site.origin)
                        if mapped != href:
                            child.attrSet("href", mapped)
                            changed = True
            if changed:
                block.body = cast(str, parser.renderer.render(tokens, parser.options, {}))
                block.body_format = "html"
    for record in records:
        record.body_html = remap_html(record.body_html, paths, site.origin)


def _body_link(child: Token, asset: AssetExporter, links: dict[str, str], allowed_paths: set[str], origin: str = "") -> None:
    href = str(child.attrGet("href") or "")
    mapped = remap_url(href, links, origin)
    if mapped != href:
        child.attrSet("href", mapped)
        return
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
    elif not parsed.scheme and not parsed.netloc and parsed.path in allowed_paths:
        return
    elif href not in allowed_paths:
        raise HTTPException(422, "A public body links to an unpublished or unsupported internal page")


def body_html(note: Note, asset: AssetExporter, links: dict[str, str], allowed_paths: set[str], origin: str = "") -> str:
    parser = MarkdownIt("commonmark", {"html": False, "linkify": False})
    tokens = parser.parse(note.body)
    for token in tokens:
        for child in token.children or []:
            if child.type == "image":
                child.attrSet("src", asset(str(child.attrGet("src") or ""), note))
            elif child.type == "link_open":
                _body_link(child, asset, links, allowed_paths, origin)
    return cast(str, parser.renderer.render(tokens, parser.options, {}))
