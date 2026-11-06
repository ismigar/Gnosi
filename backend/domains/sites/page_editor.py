"""Non-destructive editorial projections of imported static pages."""
from __future__ import annotations

import json

from bs4 import BeautifulSoup
from fastapi import HTTPException

from .importer import _groups, _imported_body, obj, rows
from .models import PublicRecord, SiteBlock, SiteConfig, SitePage
from .storage import SiteStore


def static_blocks(body: str) -> list[SiteBlock]:
    """Keep complex HTML intact; expose unambiguous text/image rows as split blocks."""
    soup = BeautifulSoup(body, "html.parser")
    layouts = soup.select(".content-extra > .layout")
    if not layouts:
        return [SiteBlock(type="text", body=body, body_format="html")]
    # Ancestor anchors/styles cannot be represented on independently sorted blocks.
    if any(set(parent.attrs) - {"class"} or set(parent.get("class", [])) - {"content-extra"}
           for layout in layouts for parent in layout.parents if getattr(parent, "attrs", None)):
        return [SiteBlock(type="text", body=body, body_format="html")]
    result = []
    for layout in layouts:
        regions = layout.find_all(class_="layout__region", recursive=False)
        # Split blocks only represent plain equal-width rows. Keep other row
        # semantics (ratios, anchors, classes and attributes) in lossless HTML.
        plain_row = (set(layout.attrs) <= {"class"}
                     and set(layout.get("class", [])) <= {"layout", "layout--twocol-section", "layout--twocol-section--50-50"})
        if len(regions) == 2 and plain_row:
            pictures = [region.find_all("img") for region in regions]
            image_side = next((index for index in (0, 1) if len(pictures[index]) == 1 and not pictures[1 - index]), None)
            if image_side is not None:
                region = regions[image_side]
                # A row with captions, links or text next to the image stays lossless HTML.
                image = pictures[image_side][0]
                plain_region = (set(region.attrs) <= {"class"}
                                and set(region.get("class", [])) <= {"layout__region", "layout__region--first", "layout__region--second"})
                plain_wrappers = all(node.name == "div" and set(node.attrs) <= {"class"}
                                     and set(node.get("class", [])) <= {"img-coneix-me", "img-temenos"}
                                     for node in region.find_all(True) if node is not image)
                if (plain_region and plain_wrappers and set(image.attrs) <= {"src", "alt"}
                        and not region.get_text(strip=True) and not region.find("a")):
                    framed = any(set(parent.get("class", [])) & {"img-coneix-me", "img-temenos"}
                                 for parent in image.parents if parent is not region)
                    result.append(SiteBlock(type="split", body=str(regions[1 - image_side]), body_format="html",
                                            image=str(image.get("src", "")), alt=str(image.get("alt", "")),
                                            image_width=80 if framed else 100, image_frame="inset" if framed else "none",
                                            alignment="center" if framed else "left",
                                            image_position="left" if image_side == 0 else "right"))
                    continue
        if layout.get_text(strip=True) or layout.find(["img", "video", "audio", "iframe"]):
            result.append(SiteBlock(type="text", body=str(layout), body_format="html"))
    # Do not drop meaningful content outside the recognized layouts.
    remainder = BeautifulSoup(body, "html.parser")
    for layout in remainder.select(".content-extra > .layout"):
        layout.decompose()
    if remainder.get_text(strip=True) or remainder.find(["img", "video", "audio", "iframe"]):
        return [SiteBlock(type="text", body=body, body_format="html")]
    return result or [SiteBlock(type="text", body=body, body_format="html")]


def imported_static_pages(store: SiteStore, site: SiteConfig) -> list[SitePage]:
    if not site.legacy_pilot:
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
            pages.append(SitePage(id="imported-page-" + identity + "-" + language, imported_record_id=identity,
                                  translation_id=identity, language=language, title=str(node["title"]),
                                  path=str(node["url"]), enabled=True, blocks=static_blocks(_imported_body(node, True))))
    return pages


def apply_page_overrides(site: SiteConfig, public: dict[tuple[str, str], PublicRecord]) -> None:
    """Only an explicit, enabled static-page override may replace its imported URL."""
    for page in site.pages:
        if not page.enabled or not page.imported_record_id:
            continue
        key = page.imported_record_id, page.language
        record = public.get(key)
        if record is None or record.path != page.path or record.presentation.get("kind") != "page":
            raise HTTPException(422, "The imported static page is no longer published at this URL")
        public.pop(key)
