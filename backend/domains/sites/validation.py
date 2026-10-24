"""Closed website CSS and URL configuration validation."""
from __future__ import annotations

import re
from urllib.parse import urlsplit

from fastapi import HTTPException

from .models import SiteConfig


def validate_css(css: str) -> None:
    # CSS never executes in Gnosi; reject external fetches and markup boundaries.
    lowered = re.sub(r"/\*.*?\*/", "", css, flags=re.S).lower()
    if any(token in lowered for token in ("@import", "url(", "expression(", "javascript:", "</", "@charset", "\\")):
        raise HTTPException(422, "CSS must not load external resources or contain markup")
    stack: list[str] = []
    quote = ""
    for char in lowered:
        if quote:
            if char == quote:
                quote = ""
            continue
        if char in {"'", '"'}:
            quote = char
        elif char == "{":
            stack.append(char)
        elif char == "}":
            if not stack:
                raise HTTPException(422, "Unbalanced CSS blocks")
            stack.pop()
    if stack or quote:
        raise HTTPException(422, "Unbalanced CSS blocks or strings")


def safe_link(value: str, *, image: bool = False) -> None:
    if not value:
        return
    if value.startswith("/") and not value.startswith("//"):
        if ".." in value.split("/") or "\\" in value:
            raise HTTPException(422, "Invalid website link")
        return
    parsed = urlsplit(value)
    allowed = {"https", "http"} if image else {"https", "http", "mailto", "tel"}
    if parsed.scheme not in allowed or parsed.username or parsed.password or any(ord(c) < 32 for c in value):
        raise HTTPException(422, "Invalid website link")


def validate_site(site: SiteConfig) -> None:
    safe_link(site.origin, image=True)
    validate_css(site.theme.advanced_css)
    for key, value in site.theme.tokens.items():
        if not re.fullmatch(r"[a-z][a-z0-9-]{0,60}", key) or len(value) > 300 or any(c in value for c in "{};<>\\") or re.search(r"url\s*\(|@import|expression\s*\(", value, re.I):
            raise HTTPException(422, "Invalid theme value")
    safe_link(site.theme.logo, image=True)
    safe_link(site.theme.favicon, image=True)
    for font in site.theme.fonts:
        safe_link(font.src, image=True)
        if any(char in font.family for char in "{};<>\\\"'") or not re.fullmatch(r"[0-9 ]{1,9}", font.weight):
            raise HTTPException(422, "Invalid website font")
    paths = [p.path for p in site.pages if p.enabled]
    if len(paths) != len(set(paths)):
        raise HTTPException(422, "Public page paths must be unique")
    for page in site.pages:
        validate_css(page.css)
        for block in page.blocks:
            validate_css(block.css)
            safe_link(block.href)
            safe_link(block.image, image=True)
            for image in block.images:
                safe_link(image, image=True)
            if block.form_id and block.form_id not in {form.id for form in site.forms}:
                raise HTTPException(422, "Unknown form block")
            if block.source_id and block.source_id not in {source.id for source in site.sources}:
                raise HTTPException(422, "Unknown collection block")
    for form in site.forms:
        safe_link(form.privacy_url)
    for link in site.navigation + site.footer + site.social_links:
        safe_link(link.href)
