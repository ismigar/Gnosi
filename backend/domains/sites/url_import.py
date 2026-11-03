"""Review public HTML before creating editable, unpublished website pages."""
from __future__ import annotations

import hashlib
import re
import sqlite3
import time
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from urllib.parse import unquote, urljoin, urlsplit, urlunsplit

from bs4 import BeautifulSoup, Tag
from bs4.element import NavigableString
from fastapi import HTTPException
from PIL import Image
from pydantic import ValidationError

from . import public_http, theme_assets
from .models import NavigationLink, SiteBlock, SiteConfig, SitePage, SiteTarget, identifier, safe_path
from .storage import SiteStore, fingerprint, private_json
from .validation import safe_link
from .web_import_models import (
    CreationReceipt, ImportedAsset, ImportedPage, ImportSnapshot,
    PreviewPage, PreviewPayload, SnapshotEnvelope,
)

MAX_ASSETS = 100
TTL = 30 * 60


def _canonical(url: str) -> str:
    parsed = urlsplit(url)
    return urlunsplit((parsed.scheme.lower(), parsed.netloc.lower(), parsed.path or "/", parsed.query, ""))


def _origin(url: str) -> tuple[str, str]:
    parsed = urlsplit(url)
    return parsed.scheme, parsed.netloc.lower()


def _path(url: str) -> str:
    parsed = urlsplit(url)
    if parsed.query:
        raise ValueError("Query-dependent routes need manual migration")
    return safe_path(unquote(parsed.path or "/"))


def _language(soup: BeautifulSoup) -> str:
    tag = soup.find("html")
    lang = str(tag.get("lang", "en") if isinstance(tag, Tag) else "en").strip().lower().replace("_", "-")
    return lang if re.fullmatch(r"[a-z]{2,3}(?:-[a-z]{2,8})?", lang) else "en"


def _link(value: str, base: str) -> str:
    try:
        result = urljoin(base, value)
        safe_link(result)
    except (HTTPException, ValueError):
        return ""
    return result.replace("(", "%28").replace(")", "%29").replace("<", "%3C").replace(">", "%3E")


def _text(value: str) -> str:
    return re.sub(r"([\\`*_{}\[\]<>])", r"\\\1", value)


def _image_marker(node: Tag, base: str, images: list[dict[str, str]]) -> str:
    source = str(node.get("src") or node.get("data-src") or "")
    href = _link(source, base) if source else ""
    if not href.startswith(("http://", "https://")):
        return ""
    token = "GNOSIIMPORTIMAGE" + identifier() + "TOKEN"
    images.append({"url": href, "alt": str(node.get("alt", ""))[:1000], "token": token})
    return "\n\n" + token + "\n\n"


def _inline_markdown(node: Tag, body: str, base: str) -> str:
    if node.name == "a":
        href = _link(str(node.get("href", "")), base)
        return "[" + body.strip() + "](" + href + ")" if href and body.strip() else body
    wrappers = {"strong": "**", "b": "**", "em": "*", "i": "*"}
    wrapper = wrappers.get(node.name, "")
    return wrapper + body + wrapper


def _markdown(node: object, base: str, images: list[dict[str, str]]) -> str:
    if isinstance(node, NavigableString):
        return _text(str(node))
    if not isinstance(node, Tag):
        return ""
    name = node.name
    if name == "img":
        return _image_marker(node, base, images)
    body = "".join(_markdown(child, base, images) for child in node.children)
    if name in {"h1", "h2", "h3", "h4", "h5", "h6"}:
        return "\n\n" + "#" * int(name[1]) + " " + body.strip() + "\n\n"
    if name in {"p", "div", "section", "article", "main", "ul", "ol", "table", "tr"}:
        return "\n\n" + body.strip() + "\n\n"
    if name == "li":
        return "\n- " + body.strip() + "\n"
    if name == "br":
        return "\n"
    if name in {"strong", "b", "em", "i", "a"}:
        return _inline_markdown(node, body, base)
    if name in {"td", "th"}:
        return body.strip() + " | "
    if name == "blockquote":
        return "\n\n" + "\n".join("> " + line for line in body.strip().splitlines()) + "\n\n"
    if name in {"code", "pre"}:
        return "\n\n" + "\n".join("    " + line for line in node.get_text().splitlines()) + "\n\n"
    return body


def _content_blocks(main: Tag, base: str) -> list[SiteBlock]:
    images: list[dict[str, str]] = []
    markdown = _markdown(main, base, images)
    blocks: list[SiteBlock] = []
    image_tokens = {image["token"]: image for image in images}
    pattern = "(" + "|".join(re.escape(token) for token in image_tokens) + ")" if image_tokens else None
    for part in re.split(pattern, markdown) if pattern else [markdown]:
        if part in image_tokens:
            image = image_tokens[part]
            blocks.append(SiteBlock(type="image", image=image["url"], alt=image["alt"]))
        elif part.strip():
            blocks.append(SiteBlock(type="text", body=re.sub(r"\n{3,}", "\n\n", part).strip()))
    return blocks


def _discovered_links(soup: BeautifulSoup, base: str) -> list[str]:
    links = []
    for anchor in soup.select("a[href], link[rel~=alternate][href]")[:2000]:
        href = _link(str(anchor.get("href", "")), base)
        if href.startswith(("http://", "https://")):
            links.append(_canonical(href))
    return links


def _navigation(soup: BeautifulSoup, base: str, language: str) -> list[NavigationLink]:
    links = []
    for anchor in soup.select("nav a[href], header a[href]")[:100]:
        href = _link(str(anchor.get("href", "")), base)
        label = anchor.get_text(" ", strip=True)[:300]
        if href and label:
            links.append(NavigationLink(label=label, href=href, language=language))
    return links


@dataclass
class ExtractedPage:
    page: ImportedPage
    links: list[str]
    forms: bool
    fallback: bool


def _extract(response: public_http.PublicResponse) -> ExtractedPage:
    soup = BeautifulSoup(response.body, "html.parser")
    title = (soup.title.get_text(" ", strip=True) if soup.title else "") or urlsplit(response.url).hostname or "Website"
    language = _language(soup)
    links = _discovered_links(soup, response.url)
    navigation = _navigation(soup, response.url, language)
    has_forms = bool(soup.find("form"))
    for node in soup(["script", "style", "noscript", "iframe", "object", "embed", "svg", "form", "template"]):
        node.decompose()
    main = soup.find("main") or soup.find("article")
    fallback = main is None
    if not isinstance(main, Tag):
        for node in soup(["header", "nav", "footer", "aside"]):
            node.decompose()
        main = soup.body or soup
    page = ImportedPage(id=identifier(), title=title[:300], path=_path(response.url), language=language,
                        url=response.url, blocks=_content_blocks(main, response.url), navigation=navigation)
    return ExtractedPage(page, links, has_forms, fallback)


def _directory(store: SiteStore, preview_id: str) -> Path:
    if not re.fullmatch(r"[a-f0-9]{32}", preview_id):
        raise HTTPException(404, "Website import preview not found")
    root = store.private_root / "url-imports"
    target = root / preview_id
    if root.is_symlink() or target.is_symlink():
        raise HTTPException(409, "Invalid website import storage")
    return target


@dataclass
class Crawl:
    pending: list[str]
    website_url: str = ""
    pages: list[ImportedPage] = field(default_factory=list)
    visited: set[str] = field(default_factory=set)
    paths: set[str] = field(default_factory=set)
    warnings: list[str] = field(default_factory=lambda: [
        "Only publicly readable HTML content is imported. Review layout, links and language associations; CMS data and server functionality are not migrated.",
    ])


def _page_warnings(extracted: ExtractedPage) -> list[str]:
    path = extracted.page.path
    result = []
    if not extracted.page.blocks:
        result.append(path + ": no readable main content was found; JavaScript-rendered content may require manual migration.")
    if extracted.forms:
        result.append(path + ": original forms were omitted; configure a new contact form before enabling it.")
    if extracted.fallback:
        result.append(path + ": no main/article region was found; review the extracted content.")
    return result


def _crawl_page(crawl: Crawl, current: str, budget: public_http.FetchBudget) -> None:
    _path(current)
    response = public_http.fetch(current, budget)
    if not crawl.website_url:
        crawl.website_url = response.url
    if _origin(response.url) != _origin(crawl.website_url):
        raise ValueError("Redirected outside the imported website")
    if response.content_type.split(";", 1)[0].strip() not in {"text/html", "application/xhtml+xml"}:
        raise ValueError("The URL is not an HTML page")
    extracted = _extract(response)
    if extracted.page.path in crawl.paths:
        raise ValueError("A page with this route was already imported")
    crawl.paths.add(extracted.page.path)
    crawl.pages.append(extracted.page)
    crawl.warnings.extend(_page_warnings(extracted))
    for link in extracted.links:
        if _origin(link) == _origin(crawl.website_url) and link not in crawl.visited and link not in crawl.pending and len(crawl.pending) < 1000:
            crawl.pending.append(link)


def _crawl(url: str, max_pages: int, budget: public_http.FetchBudget) -> Crawl:
    try:
        crawl = Crawl(pending=[_canonical(url)])
    except ValueError:
        raise HTTPException(422, "Use a public HTTP or HTTPS URL") from None
    while crawl.pending and len(crawl.pages) < max_pages and len(crawl.visited) < max_pages * 3:
        current = crawl.pending.pop(0)
        if current in crawl.visited:
            continue
        crawl.visited.add(current)
        try:
            _crawl_page(crawl, current, budget)
        except (public_http.PublicFetchError, ValueError) as error:
            if not crawl.pages:
                raise HTTPException(422, str(error)) from None
            crawl.warnings.append(current[:300] + ": " + str(error))
        if time.monotonic() >= budget.deadline or budget.remaining <= 0:
            crawl.warnings.append("The import reached its time or download limit; the preview is partial.")
            break
    if crawl.pending:
        crawl.warnings.append("The crawl stopped at its page, request or time limit; additional pages were not imported.")
    return crawl


def _download_image(source: str, budget: public_http.FetchBudget) -> tuple[bytes, str]:
    response = public_http.fetch(source, budget, maximum=theme_assets.LIMIT)
    with Image.open(BytesIO(response.body)) as image:
        suffix = {"PNG": ".png", "JPEG": ".jpg", "WEBP": ".webp", "GIF": ".gif"}.get(str(image.format))
    if suffix is None:
        raise ValueError("Unsupported image format")
    theme_assets.image_preview(response.body, suffix)
    return response.body, suffix


def _download_assets(crawl: Crawl, budget: public_http.FetchBudget) -> dict[str, tuple[bytes, str]]:
    assets: dict[str, tuple[bytes, str]] = {}
    for page in crawl.pages:
        kept = []
        for block in page.blocks:
            if block.type != "image":
                kept.append(block)
                continue
            try:
                if block.image not in assets:
                    if len(assets) >= MAX_ASSETS:
                        raise ValueError("The image limit was reached")
                    assets[block.image] = _download_image(block.image, budget)
                kept.append(block)
            except (public_http.PublicFetchError, HTTPException, OSError, ValueError) as error:
                detail = str(error.detail) if isinstance(error, HTTPException) else str(error)
                crawl.warnings.append("Image skipped: " + block.image[:200] + ": " + detail)
        page.blocks = kept
    return assets


def _write_assets(root: Path, assets: dict[str, tuple[bytes, str]]) -> dict[str, ImportedAsset]:
    entries = {}
    for source, (raw, suffix) in assets.items():
        digest = hashlib.sha256(raw).hexdigest()
        filename = digest + suffix
        path = root / filename
        path.write_bytes(raw)
        path.chmod(0o600)
        entries[source] = ImportedAsset(file=filename, sha256=digest)
    return entries


def preview(store: SiteStore, url: str, max_pages: int = 20) -> PreviewPayload:
    if not 1 <= max_pages <= 100:
        raise HTTPException(422, "Choose between 1 and 100 pages")
    budget = public_http.FetchBudget.start()
    crawl = _crawl(url, max_pages, budget)
    assets = _download_assets(crawl, budget)
    preview_id = identifier()
    root = _directory(store, preview_id)
    root.mkdir(parents=True, mode=0o700)
    entries = _write_assets(root, assets)
    expires = time.time() + TTL
    snapshot = ImportSnapshot(id=preview_id, url=crawl.website_url, name=crawl.pages[0].title, pages=crawl.pages,
                              assets=entries, owner=store.context.user_id, expires=expires, warnings=crawl.warnings[:250])
    payload = snapshot.model_dump(mode="json")
    private_json(root / "snapshot.json", {"snapshot": payload, "digest": fingerprint(payload)})
    pages: list[PreviewPage] = [{"id": page.id, "title": page.title, "path": page.path, "language": page.language} for page in crawl.pages]
    return {"id": preview_id, "url": crawl.website_url, "name": snapshot.name, "pages": pages,
            "warnings": snapshot.warnings, "expires_at": datetime.fromtimestamp(expires, timezone.utc).isoformat(), "assets_count": len(assets)}


def _read_snapshot(root: Path, owner: str) -> ImportSnapshot:
    path = root / "snapshot.json"
    if not path.is_file() or path.is_symlink():
        raise HTTPException(404, "Website import preview not found")
    try:
        if path.stat().st_size > 128 * 1024 * 1024:
            raise ValueError("Invalid snapshot size")
        envelope = SnapshotEnvelope.model_validate_json(path.read_bytes())
    except (OSError, ValueError):
        raise HTTPException(409, "The website import preview is unavailable or changed") from None
    snapshot = envelope.snapshot
    if fingerprint(snapshot.model_dump(mode="json")) != envelope.digest or snapshot.owner != owner:
        raise HTTPException(409, "The website import preview is unavailable or changed")
    if snapshot.expires <= time.time():
        raise HTTPException(410, "The website import preview expired; review the URL again")
    return snapshot


def _previous_result(store: SiteStore, receipt: Path, request_digest: str) -> SiteConfig | None:
    if not receipt.exists():
        return None
    try:
        if receipt.is_symlink():
            raise ValueError("Invalid receipt")
        prior = CreationReceipt.model_validate_json(receipt.read_bytes())
    except (OSError, ValueError):
        raise HTTPException(409, "The website import creation receipt is unavailable") from None
    if prior.request != request_digest:
        raise HTTPException(409, "This preview has already created a website")
    return store.load(prior.site_id)


def _import_image(store: SiteStore, site: SiteConfig, root: Path, entry: ImportedAsset) -> str:
    path = root / entry.file
    try:
        if path.is_symlink() or path.parent != root or path.stat().st_size > theme_assets.LIMIT:
            raise OSError("Invalid image file")
        raw = path.read_bytes()
    except OSError:
        raise HTTPException(409, "An imported image is unavailable") from None
    if hashlib.sha256(raw).hexdigest() != entry.sha256:
        raise HTTPException(409, "An imported image changed after review")
    return theme_assets.upload(store, site, path.name, raw, "image")[0]


def _project_blocks(store: SiteStore, site: SiteConfig, root: Path, snapshot: ImportSnapshot,
                    page: ImportedPage, local_links: dict[str, str], assets: dict[str, str]) -> list[SiteBlock]:
    blocks = []
    for original in page.blocks:
        block = original.model_copy(deep=True)
        if block.type == "image":
            source = block.image
            if source not in assets:
                entry = snapshot.assets.get(source)
                if entry is None:
                    raise HTTPException(409, "An imported image is unavailable")
                assets[source] = _import_image(store, site, root, entry)
            block.image = assets[source]
        else:
            for original_url, destination in local_links.items():
                block.body = block.body.replace("](" + original_url + ")", "](" + destination + ")")
        blocks.append(block)
    return blocks


def _project_site(store: SiteStore, root: Path, snapshot: ImportSnapshot, name: str,
                  pages: list[ImportedPage]) -> SiteConfig:
    languages = list(dict.fromkeys(page.language for page in pages))
    try:
        site = SiteConfig(name=name, origin=snapshot.url, languages=languages, default_language=languages[0],
                          forms=[], targets=[SiteTarget(id="local", enabled=True)])
    except ValidationError:
        raise HTTPException(422, "The imported website configuration is invalid") from None
    local_links = {page.url: page.path for page in pages}
    assets: dict[str, str] = {}
    for page in pages:
        blocks = _project_blocks(store, site, root, snapshot, page, local_links, assets)
        site.pages.append(SitePage(id=page.id, title=page.title, path=page.path, language=page.language, enabled=True, blocks=blocks))
        for original in page.navigation:
            link = original.model_copy(update={"href": local_links.get(original.href, original.href)})
            if link not in site.navigation:
                site.navigation.append(link)
    return site


@contextmanager
def _creation_lock(path: Path) -> Iterator[None]:
    # SQLite provides an interprocess lock on every supported desktop platform.
    connection = sqlite3.connect(path, timeout=5)
    try:
        try:
            connection.execute("BEGIN IMMEDIATE")
        except sqlite3.OperationalError:
            raise HTTPException(409, "Another creation from this preview is still running") from None
        yield
    finally:
        connection.close()


def create(store: SiteStore, preview_id: str, name: str, selected_page_ids: list[str]) -> SiteConfig:
    root = _directory(store, preview_id)
    if not root.is_dir():
        raise HTTPException(404, "Website import preview not found")
    lock_path = root / "create.lock"
    if lock_path.is_symlink():
        raise HTTPException(409, "Invalid website import storage")
    with _creation_lock(lock_path):
        snapshot = _read_snapshot(root, store.context.user_id)
        known = {page.id for page in snapshot.pages}
        chosen = set(selected_page_ids)
        if not chosen or len(chosen) != len(selected_page_ids) or not chosen <= known:
            raise HTTPException(422, "Select available pages from this preview")
        request_digest = fingerprint([name, selected_page_ids])
        receipt = root / "created.json"
        prior = _previous_result(store, receipt, request_digest)
        if prior is not None:
            return prior
        pages = [page for page in snapshot.pages if page.id in chosen]
        site = _project_site(store, root, snapshot, name, pages)
        result = store.save(site, create=True)
        private_json(receipt, {"request": request_digest, "site_id": result.id})
        return result
