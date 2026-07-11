"""`looks_like_excerpt` must measure the length of the TEXT, not of the markup.

A short teaser wrapped in a lot of HTML (nested `<div class="…">` from modern
CMSs) was classified as a full article because the old "cleanup"
(`c not in "<>"`) kept the tag names and attributes and inflated the
length above the threshold → full-body extraction was never attempted.
"""
from backend.services.article_extractor import (
    looks_like_excerpt,
    EXCERPT_LEN_THRESHOLD,
)


def test_teaser_curt_amb_marcatge_verbos_es_detecta():
    teaser = "Aquest és només el primer paràgraf introductori de la notícia. " * 2
    markup_open = "".join(
        f'<div class="paragraph-wrapper-module column-{i} responsive-grid-item">'
        for i in range(12)
    )
    content = markup_open + f"<p>{teaser}</p>" + "</div>" * 12

    # The real text is short, but the raw HTML exceeds the threshold.
    assert len(content) > EXCERPT_LEN_THRESHOLD
    # Even so, it should be considered a teaser (worth extracting the body).
    assert looks_like_excerpt(content) is True


def test_article_complet_llarg_no_es_teaser():
    # Long body of real text, no CTA → NOT a teaser.
    body = "<p>" + ("Contingut real de l'article amb prou substància. " * 40) + "</p>"
    assert len(body) > EXCERPT_LEN_THRESHOLD  # sanity
    assert looks_like_excerpt(body) is False


def test_buit_es_teaser():
    assert looks_like_excerpt("") is True
    assert looks_like_excerpt(None) is True


def test_cta_al_final_marca_teaser_encara_que_sigui_llarg():
    body = "<p>" + ("Text de farciment prou llarg per superar el llindar. " * 30) + "</p>"
    body += '<a href="https://x">Read full article</a>'
    assert len(body) > EXCERPT_LEN_THRESHOLD
    assert looks_like_excerpt(body) is True
