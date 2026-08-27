"""`html_meta_to_zotero_item` must read the meta tags regardless of
attribute order (`content` can come before `name`/`property`).

The old parsing required `name=…` BEFORE `content=…` with a single regex,
and silently lost every meta tag with the reversed order — common
on many publisher pages.
"""
from backend.services.lookup_normalizers import html_meta_to_zotero_item


NAME_FIRST = """
<html><head>
<meta name="citation_title" content="Thinking, Fast and Slow">
<meta name="citation_author" content="Kahneman, Daniel">
<meta name="citation_doi" content="10.1234/abcd.5678">
<meta name="citation_publication_date" content="2011-06-15">
<meta property="og:title" content="OG Title">
<meta name="DC.creator" content="Tversky, Amos">
</head></html>
"""

CONTENT_FIRST = """
<html><head>
<meta content="Thinking, Fast and Slow" name="citation_title">
<meta content="Kahneman, Daniel" name="citation_author">
<meta content="10.1234/abcd.5678" name="citation_doi">
<meta content="2011-06-15" name="citation_publication_date">
<meta content="OG Title" property="og:title">
<meta content="Tversky, Amos" name="DC.creator">
</head></html>
"""


def test_ordre_normal_segueix_funcionant():
    item = html_meta_to_zotero_item(NAME_FIRST, "http://x")
    assert item["title"] == "Thinking, Fast and Slow"
    assert item["DOI"] == "10.1234/abcd.5678"
    assert item["date"] == "2011"
    last_names = {c.get("lastName") for c in item["creators"]}
    assert "Kahneman" in last_names
    assert "Tversky" in last_names  # DC.creator


def test_ordre_invertit_ja_no_es_perd():
    item = html_meta_to_zotero_item(CONTENT_FIRST, "http://x")
    # Before the fix this returned {} (only url) because no meta tag matched.
    assert item["title"] == "Thinking, Fast and Slow"
    assert item["DOI"] == "10.1234/abcd.5678"
    assert item["date"] == "2011"
    last_names = {c.get("lastName") for c in item["creators"]}
    assert "Kahneman" in last_names
    assert "Tversky" in last_names


def test_els_dos_ordres_donen_el_mateix():
    a = html_meta_to_zotero_item(NAME_FIRST, "http://x")
    b = html_meta_to_zotero_item(CONTENT_FIRST, "http://x")
    assert a == b


def test_fallback_title_quan_no_hi_ha_meta():
    html = "<html><head><title>Títol del document</title></head></html>"
    item = html_meta_to_zotero_item(html, "http://x")
    assert item["title"] == "Títol del document"
