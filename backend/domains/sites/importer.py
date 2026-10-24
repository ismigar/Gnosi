"""Freeze the existing public pilot as an explicitly selected publication source."""
from __future__ import annotations

import hashlib
import json
import re
import shutil
from html import escape
from pathlib import Path
from typing import cast

from fastapi import HTTPException
from pydantic import JsonValue

from .models import BundleAsset, CatalogueItem, NavigationLink, PublicRecord, SiteBlock, SiteConfig, SiteFont, SitePage, SiteSource
from .storage import SiteStore, private_json


def obj(value: JsonValue) -> dict[str, JsonValue]:
    return value if isinstance(value, dict) else {}


def rows(value: JsonValue) -> list[dict[str, JsonValue]]:
    return [obj(item) for item in value] if isinstance(value, list) else []


def _groups(node: dict[str, JsonValue], type_map: dict[str, JsonValue]) -> list[str]:
    kind = node.get("type")
    if kind == "article":
        return ["blog"]
    if kind == "disseny":
        return ["design"]
    if kind == "col_laboradora":
        return ["collaborators"]
    if kind == "recurs":
        values = obj(node.get("fields", {})).get("field_tipus", [])
        values = values if isinstance(values, list) else [values]
        found = {str(type_map.get(str(obj(value).get("value", "") if isinstance(value, dict) else value).lower(), "")) for value in values}
        return sorted(found & {"research", "stories"})
    return ["pages"]


def seed_import(store: SiteStore, site: SiteConfig, pilot_root: Path) -> None:
    """Only administrator-bound driver paths can supply an existing public baseline."""
    pilot_root = pilot_root.resolve(strict=True)
    source = pilot_root / "src/data/site.json"
    if not source.is_file() or not (pilot_root / "scripts/web_publish_driver.py").is_file():
        raise HTTPException(409, "The configured public pilot snapshot is unavailable")
    raw = source.read_bytes()
    data = obj(json.loads(raw))
    root = store.site_dir(site.id) / "imported"
    root.mkdir(mode=0o700, exist_ok=True)
    type_map = obj(json.loads((pilot_root / "config/resource-types.json").read_text()))
    nodes = rows(data.get("nodes", []))
    assets: list[dict[str, JsonValue]] = []
    public = pilot_root / "public"
    allowed = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".avif", ".woff", ".woff2", ".pdf", ".stl", ".obj", ".3mf", ".step", ".stp", ".dxf", ".mp3", ".mp4", ".ogg"}
    for directory in ("brand", "fonts", "sites", "gnosi-assets", "icons"):
        if not (public / directory).is_dir():
            continue
        for asset in sorted((public / directory).rglob("*")):
            if not asset.is_file() or asset.is_symlink() or asset.suffix.lower() not in allowed:
                continue
            relative = asset.relative_to(public)
            if any(part.startswith(".") for part in relative.parts):
                continue
            target = root / "assets" / relative
            target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            shutil.copyfile(asset, target)
            target.chmod(0o600)
            assets.append({"path": "/" + str(relative), "sha256": hashlib.sha256(target.read_bytes()).hexdigest(), "private_source": str(target)})
    private_json(root / "baseline.json", {"data": data, "type_map": type_map, "assets": assets, "source_sha256": hashlib.sha256(raw).hexdigest()})
    site.name = "Temenos Ismael"
    site.languages = [str(value) for value in cast(list[JsonValue], data.get("languages", ["ca", "es", "en-gb"]))]
    site.origin = str(data.get("origin", "https://temenosismael.org"))
    site.theme.tokens.update({"font-body": '"Crimson Pro", Georgia, serif', "font-heading": '"Nunito", system-ui, sans-serif'})
    site.theme.logo = "/brand/temenos-ismael-horizontal-transparent.png"
    site.theme.logo_alt = site.name
    for face in re.findall(r"@font-face\s*\{([^}]+)\}", (pilot_root / "src/styles/brand.css").read_text()):
        family = re.search(r"font-family:\s*['\"]([^'\"]+)", face)
        url = re.search(r"url\(([^)]+)\)", face)
        weight = re.search(r"font-weight:\s*([^;]+)", face)
        style = re.search(r"font-style:\s*(italic|normal)", face)
        if family and url:
            site.theme.fonts.append(SiteFont(family=family[1], src=url[1].strip("'\""), weight=weight[1].strip() if weight else "400", style="italic" if style and style[1] == "italic" else "normal"))
    definitions = {"pages": ("Pàgines", "/pages"), "blog": ("Blog", "/blog"), "research": ("Investigacions", "/investigacio"), "stories": ("Relats", "/relats"), "design": ("Dissenys", "/dissenys"), "collaborators": ("Col·laboradores", "/collaboradores")}
    site.sources = [SiteSource(id="imported-" + group, kind="page", source_id="imported:" + group, title=title, enabled=True, include_body=True, path_prefix=prefix) for group, (title, prefix) in definitions.items()]
    site.pages = []
    home = obj(data.get("home_content", {}))
    selection = obj(json.loads((pilot_root / "config/homepage.json").read_text()))
    nids = selection.get("reading_ids", [])
    reading_ids = list(dict.fromkeys(str(node["uuid"]) for node in nodes if isinstance(nids, list) and node.get("nid") in nids))
    contact = site.forms[0]
    contact.enabled = True
    for lang in site.languages:
        text = obj(home.get(lang, {}))
        site.pages.append(SitePage(id="home-" + lang, translation_id="imported:home", title=str(text.get("tagline", site.name)), path="/" + lang, language=lang, template="home", enabled=True, blocks=[
            SiteBlock(type="split", title="", body=str(text.get("intro", "")), image=str(selection.get("photograph", "")), alt=site.name),
            SiteBlock(type="selected", title={"ca": "Lectures per començar", "es": "Lecturas para empezar"}.get(lang, "Selected reading"), page_ids=reading_ids, limit=3),
        ]))
        site.pages.append(SitePage(id="contact-" + lang, translation_id="imported:contact", title=contact.title.get(lang, "Contact"), path="/" + lang + "/form/contact", language=lang, enabled=True, blocks=[SiteBlock(type="form", form_id=contact.id)]))
        _add_imported_collections(site, lang, definitions)
        about = next((node for node in nodes if node.get("nid") == 2656 and node.get("lang") == lang), None)
        if about:
            site.navigation.insert(0, NavigationLink(label=str(about["title"]), href=str(about["url"]), language=lang))
        site.navigation.append(NavigationLink(label=contact.title.get(lang, "Contact"), href="/" + lang + "/form/contact", language=lang))
    for route in rows(data.get("routes", [])):
        if route.get("kind") != "tag":
            continue
        lang = str(route.get("lang", site.default_language))
        tid = route.get("tid")
        selected = [str(node["uuid"]) for node in nodes if node.get("lang") == lang and any(tag.get("tid") == tid for tag in rows(node.get("tags", [])))]
        site.pages.append(SitePage(id="tag-" + str(tid) + "-" + lang, translation_id="imported:tag:" + str(tid), title=str(route.get("title", "")), path=str(route["path"]), language=lang, enabled=True, template="listing", blocks=[SiteBlock(type="selected", page_ids=selected, limit=100)]))
    site.social_links = [NavigationLink(label=name, href=url) for name, url in [
        ("Mastodon", "https://mastodon.social/@temenosismael"), ("LinkedIn", "https://www.linkedin.com/company/temenosismael"),
        ("Facebook", "https://www.facebook.com/temenosismael"), ("Telegram", "https://telegram.me/temenosismael"),
    ]]
    public_paths = {str(node["url"]) for node in nodes} | {page.path for page in site.pages}
    public_paths |= {"/" + lang + source.path_prefix for lang in site.languages for source in site.sources}
    public_paths |= {"/" + lang + suffix for lang in site.languages for suffix in ("/search/node", "/mapa-web")}
    # Aliases may point at content or generated public search/map pages.
    site.redirects = _imported_redirects(data, public_paths)


def imported_catalogue(store: SiteStore) -> list[CatalogueItem]:
    return [CatalogueItem(id=source.source_id, kind="page", title=site.name + " · " + source.title) for site in store.list() if site.legacy_pilot for source in site.sources if source.source_id.startswith("imported:")]


def eligible_note(metadata: dict[str, JsonValue]) -> bool:
    """Keep the established Temenos internal-resource exclusions after migration."""
    value = metadata.get("Tipus") or metadata.get("Tipus de recurs") or metadata.get("Item Type") or ""
    values = value if isinstance(value, list) else [value]
    excluded = {"curs", "manual", "ruta en bici", "article divulgatiu", "infografía", "infografia", "manifest", "menifest"}
    names = {str(obj(item).get("value", "") if isinstance(item, dict) else item).strip().lower() for item in values}
    return not bool(names & excluded)


def merge_imported_bundle(store: SiteStore, site: SiteConfig, public: dict[tuple[str, str], PublicRecord], assets: dict[str, BundleAsset], hashes: dict[str, str]) -> None:
    if not site.legacy_pilot:
        return
    path = store.site_dir(site.id) / "imported/baseline.json"
    if not path.is_file():
        raise HTTPException(409, "Import the existing public pilot snapshot again")
    payload = obj(json.loads(path.read_text()))
    data = obj(payload["data"])
    type_map = obj(payload.get("type_map", {}))
    from .exporter import is_public_metadata
    baseline_nodes = rows(data.get("nodes", []))
    baseline_ids = {str(node["uuid"]) for node in baseline_nodes}
    for source in site.sources:
        if source.enabled and source.source_id.startswith("imported:") and source.selection_mode == "selected" and set(source.page_ids) - baseline_ids - set(source.withdrawn_ids):
            raise HTTPException(409, "An explicitly selected imported record is unavailable")
    for node in baseline_nodes:
        if not is_public_metadata(node):
            continue
        groups = _groups(node, type_map)
        key = str(node["uuid"]), str(node["lang"])
        selected = [source for source in site.sources if source.enabled and source.source_id in {"imported:" + group for group in groups} and key[0] not in source.withdrawn_ids and (source.selection_mode != "selected" or key[0] in source.page_ids)]
        existing = public.get(key)
        if existing:
            existing.path = str(node["url"])
            existing.translation_id = key[0]
            existing.source_ids = list(dict.fromkeys(existing.source_ids + [source.id for source in selected]))
            continue
        if not selected:
            continue
        body = _imported_body(node, any(source.include_body for source in selected))
        public[key] = PublicRecord(id=key[0], language=key[1], path=str(node["url"]), title=str(node["title"]), body_html=body, source_ids=[source.id for source in selected], translation_id=key[0])
    references = _public_references(site, public)
    for entry in rows(payload.get("assets", [])):
        asset = BundleAsset.model_validate(entry)
        if asset.path not in references:
            continue
        asset_source = Path(asset.private_source)
        if not asset_source.is_file() or hashlib.sha256(asset_source.read_bytes()).hexdigest() != asset.sha256:
            raise HTTPException(409, "An imported public asset changed or is missing")
        assets[asset.path] = asset


def _imported_body(node: dict[str, JsonValue], show_body: bool) -> str:
    if not show_body:
        return ""
    body = str(node.get("body_html", ""))
    fields = obj(node.get("fields", {}))
    for image in rows(fields.get("field_image", [])):
        body = '<figure><img src="' + escape(str(image.get("url", "")), quote=True) + '" alt="' + escape(str(image.get("alt", "")), quote=True) + '"></figure>' + body
    for attachment in rows(fields.get("field_fitxer", [])):
        body += '<p><a href="' + escape(str(attachment.get("url", "")), quote=True) + '">' + escape(str(attachment.get("description") or attachment.get("name") or "Download")) + '</a></p>'
    return body


def _public_references(site: SiteConfig, public: dict[tuple[str, str], PublicRecord]) -> set[str]:
    references = {site.theme.logo, site.theme.favicon} | {font.src for font in site.theme.fonts}
    for record in public.values():
        references.update(re.findall(r'(?:src|href)=["\']([^"\']+)', record.body_html))
    for page in site.pages:
        if page.enabled:
            for block in page.blocks:
                references.add(block.image)
                references.update(block.images)
    return references


_COLLECTION_TITLES = {
    "ca": {"pages": "Pàgines", "blog": "Blog", "research": "Investigació", "stories": "Relats", "design": "Dissenys", "collaborators": "Col·laboradores"},
    "es": {"pages": "Páginas", "blog": "Blog", "research": "Investigación", "stories": "Relatos", "design": "Diseños", "collaborators": "Colaboradoras"},
    "en-gb": {"pages": "Pages", "blog": "Blog", "research": "Research", "stories": "Stories", "design": "Designs", "collaborators": "Collaborators"},
}


def _add_imported_collections(site: SiteConfig, language: str, definitions: dict[str, tuple[str, str]]) -> None:
    for group, (fallback, prefix) in definitions.items():
        title = _COLLECTION_TITLES.get(language, {}).get(group, fallback)
        path = "/" + language + prefix
        site.pages.append(SitePage(id="listing-" + group + "-" + language, translation_id="imported:listing:" + group, title=title, path=path, language=language, template="listing", enabled=True))
        if group not in {"pages", "collaborators"}:
            site.navigation.append(NavigationLink(label=title, href=path, language=language))


def _imported_redirects(data: dict[str, JsonValue], public_paths: set[str]) -> dict[str, str]:
    aliases: dict[str, str] = {}
    routes = rows(data.get("routes", []))
    for route in routes:
        if route.get("kind") not in {"home", "confirmation"}:
            continue
        language = str(route.get("lang", ""))
        target = "/" + language + ("/form/contact" if route.get("kind") == "confirmation" else "")
        origin = str(route.get("path", ""))
        if target in public_paths and origin not in public_paths:
            aliases[origin] = target
    for route in routes:
        target = aliases.get(str(route.get("target", "")), str(route.get("target", "")))
        if route.get("kind") == "redirect" and target in public_paths and route.get("path") not in public_paths:
            aliases[str(route["path"])] = target
    return aliases
