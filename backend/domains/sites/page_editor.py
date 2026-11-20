"""Non-destructive editorial projections of imported static pages."""
from __future__ import annotations

import json

from bs4 import BeautifulSoup
from fastapi import HTTPException

from .importer import _groups, _imported_body, obj, rows
from .models import PublicRecord, SiteBlock, SiteConfig, SitePage, editorial_id
from .storage import SiteStore


def static_blocks(body: str) -> list[SiteBlock]:
    """Keep complex HTML intact; expose unambiguous text/image rows as split blocks."""
    soup = BeautifulSoup(body, "html.parser")
    layouts = soup.select(".content-extra > .layout")
    if not layouts:
        return [SiteBlock(type="text", body=body, body_format="html")]
    # Ancestor anchors/styles cannot be represented on independently sorted blocks.
    if any(set(parent.attrs) - {"class"} or set(parent.get_attribute_list("class")) - {"content-extra"}
           for layout in layouts for parent in layout.parents if getattr(parent, "attrs", None)):
        return [SiteBlock(type="text", body=body, body_format="html")]
    # Even empty siblings (anchors, separators, decorative nodes) are content.
    # Only structural ancestors may be discarded when extracting whole rows.
    if any(node not in layouts and not node.find_parent(class_="layout")
           and not any(layout in node.descendants for layout in layouts)
           for node in soup.find_all(True)):
        return [SiteBlock(type="text", body=body, body_format="html")]
    result = []
    for layout in layouts:
        regions = layout.find_all(class_="layout__region", recursive=False)
        # Split blocks only represent plain equal-width rows. Keep other row
        # semantics (ratios, anchors, classes and attributes) in lossless HTML.
        plain_row = (set(layout.attrs) <= {"class"}
                     and set(layout.get_attribute_list("class")) <= {"layout", "layout--twocol-section", "layout--twocol-section--50-50"})
        plain_children = all(child in regions if getattr(child, "name", None) else not str(child).strip()
                             for child in layout.children)
        if len(regions) == 2 and plain_row and plain_children:
            pictures = [region.find_all("img") for region in regions]
            image_side = next((index for index in (0, 1) if len(pictures[index]) == 1 and not pictures[1 - index]), None)
            if image_side is not None:
                region = regions[image_side]
                # A row with captions, links or text next to the image stays lossless HTML.
                image = pictures[image_side][0]
                plain_region = (set(region.attrs) <= {"class"}
                                and set(region.get_attribute_list("class")) <= {"layout__region", "layout__region--first", "layout__region--second"})
                plain_wrappers = all(node.name == "div" and set(node.attrs) <= {"class"}
                                     and set(node.get_attribute_list("class")) <= {"img-coneix-me", "img-temenos"}
                                     for node in region.find_all(True) if node is not image)
                if (plain_region and plain_wrappers and set(image.attrs) <= {"src", "alt"}
                        and not region.get_text(strip=True) and not region.find("a")):
                    framed = any(set(parent.get_attribute_list("class")) & {"img-coneix-me", "img-temenos"}
                                 for parent in image.parents if parent is not region)
                    result.append(SiteBlock(type="split", body=str(regions[1 - image_side]), body_format="html",
                                            image=str(image.get("src", "")), alt=str(image.get("alt", "")),
                                            image_width=80 if framed else 100, image_frame="inset" if framed else "none",
                                            alignment="center" if framed else "left",
                                            image_position="left" if image_side == 0 else "right"))
                    continue
        result.append(SiteBlock(type="text", body=str(layout), body_format="html"))
    # Do not drop meaningful content outside the recognized layouts.
    remainder = BeautifulSoup(body, "html.parser")
    for layout in remainder.select(".content-extra > .layout"):
        layout.decompose()
    if remainder.get_text(strip=True) or remainder.find(["img", "video", "audio", "iframe"]):
        return [SiteBlock(type="text", body=body, body_format="html")]
    return result or [SiteBlock(type="text", body=body, body_format="html")]


def imported_static_pages(store: SiteStore, site: SiteConfig) -> list[SitePage]:
    if not site.legacy_pilot or not any(source.enabled and source.source_id == "imported:pages" for source in site.sources):
        return []
    from .exporter import is_public_metadata
    payload = obj(json.loads((store.site_dir(site.id) / "imported/baseline.json").read_text()))
    pages = []
    for node in rows(obj(payload.get("data", {})).get("nodes", [])):
        if _groups(node, obj(payload.get("type_map", {}))) != ["pages"] or not is_public_metadata(node):
            continue
        identity, language = str(node["uuid"]), str(node["lang"])
        if language not in site.languages:
            continue
        selected = any(source.enabled and source.include_body and source.source_id == "imported:pages"
                       and identity not in source.withdrawn_ids and language not in source.withdrawn_versions.get(identity, [])
                       and (source.selection_mode != "selected" or identity in source.page_ids) for source in site.sources)
        if selected:
            path = str(node["url"])
            pages.append(SitePage(id=editorial_id(site.id, "page", path), imported_record_id=path,
                                  translation_id=editorial_id(site.id, "translations", identity),
                                  language=language, title=str(node["title"]), path=path,
                                  enabled=True, blocks=static_blocks(_imported_body(node, True))))
    return pages


def apply_page_overrides(site: SiteConfig, public: dict[tuple[str, str], PublicRecord]) -> None:
    """Only an explicit, enabled static-page override may replace its imported URL."""
    sources = {source.id for source in site.sources if source.enabled and source.source_id == "imported:pages"}
    by_route = {(record.path, record.language): key for key, record in public.items()
                if sources.intersection(record.source_ids) and record.presentation.get("kind") == "page"}
    translations: dict[str, str] = {}
    for page in site.pages:
        if not page.enabled or not page.imported_record_id:
            continue
        binding = page.imported_record_id
        key = by_route.get((binding, page.language)) if binding.startswith("/") else (binding, page.language)
        if key is None:
            raise HTTPException(422, "The imported static page is no longer published at this URL")
        record = public.get(key)
        if record is None or by_route.get((page.path, page.language)) != key:
            raise HTTPException(422, "The imported static page is no longer published at this URL")
        if binding.startswith("/") and page.translation_id and record.translation_id:
            translations[record.translation_id] = page.translation_id
        public.pop(key)
    # A partially edited translation group can still have published source
    # records or an older editorial override in another language.
    for record in public.values():
        if record.translation_id and record.translation_id in translations and sources.intersection(record.source_ids):
            record.translation_id = translations[record.translation_id]
    for page in site.pages:
        if page.imported_record_id and page.translation_id and page.translation_id in translations:
            page.translation_id = translations[page.translation_id]
