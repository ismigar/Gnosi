"""`looks_like_excerpt` ha de mesurar la longitud del TEXT, no del marcatge.

Un teaser curt embolcallat en molt HTML (nested `<div class="…">` dels CMS
moderns) es classificava com a article complet perquè la vella "neteja"
(`c not in "<>"`) conservava els noms d'etiqueta i atributs i inflava la
longitud per sobre del llindar → mai s'intentava l'extracció del cos complet.
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

    # El text real és curt, però el HTML cru supera el llindar.
    assert len(content) > EXCERPT_LEN_THRESHOLD
    # Tot i així, s'ha de considerar teaser (val la pena extreure el cos).
    assert looks_like_excerpt(content) is True


def test_article_complet_llarg_no_es_teaser():
    # Cos llarg de text real, sense CTA → NO és teaser.
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
