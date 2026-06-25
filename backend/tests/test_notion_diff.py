"""Tests del motor de diff Notion ↔ Vault (pur, sense xarxa)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.notion_diff import (  # noqa: E402
    extract_vault_views, extract_notion_inline_dbs, extract_notion_child_databases,
    normalize_body, body_similarity, diff_page, match_pages, headings,
)


def test_extract_vault_views():
    md = ('# A\n<!-- gnosi-view:def {"view_id":"v1"} -->\n# B\n'
          '<!-- gnosi-view:def {"view_id":"v2"} -->\n')
    assert extract_vault_views(md) == ["v1", "v2"]


def test_extract_notion_inline_dbs():
    md = '<database url="https://notion.so/p/2a6b116904844d81a7a382a809a590f6" inline="true"></database>'
    assert extract_notion_inline_dbs(md) == ["2a6b116904844d81a7a382a809a590f6"]


def test_extract_notion_child_databases():
    blocks = [{"type": "child_database", "id": "ab-cd"},
              {"type": "paragraph", "paragraph": {}, "_children": [
                  {"type": "child_database", "id": "ef12"}]}]
    assert extract_notion_child_databases(blocks) == ["abcd", "ef12"]


def test_normalize_strips_frontmatter_and_tags():
    md = ('---\ntitle: X\nid: 1\n---\n\n# Títol {color="blue_bg"}\n'
          '<database url="x" inline="true"></database>\n<!-- gnosi-view:def {"view_id":"v"} -->\nText real')
    n = normalize_body(md)
    assert "title: X" not in n  # frontmatter fora
    assert "color" not in n      # anotació de color fora
    assert "database" not in n   # embed fora
    assert "gnosi-view" not in n
    assert "Títol" in n and "Text real" in n


_ES = ("# Formación\nMontar en bici adaptada me proporciona un espacio fundamental "
       "para el descanso físico y mental, lo que me permite recargar energías y "
       "mantener un equilibrio saludable en todas las áreas de mi vida.")
_CA = ("# Formació\nAnar amb bici adaptada em proporciona un espai fonamental per al "
       "descans físic i mental, cosa que em permet recarregar energies i mantenir un "
       "equilibri saludable en totes les àrees de la meva vida.")


def test_body_similarity_identical_and_diverged():
    a = "# Hola\nContingut idèntic aquí"
    assert body_similarity(a, a) == 1.0
    assert body_similarity(_ES, _CA) < 0.6  # traducció ES→CA → diverged (cas real: 0.196)


def test_diff_page_diverged_recommends_skip():
    notion = f'{_ES}\n<database url="x/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" inline="true"></database>'
    vault = f'---\nid: 1\n---\n{_CA}\n<!-- gnosi-view:def {{"view_id":"v1"}} -->'
    d = diff_page(notion, vault)
    assert d["body_status"] == "diverged"
    assert d["notion_embeds"] == 1 and d["vault_embeds"] == 1
    assert d["safe_action"] == "skip"   # mai sobreescriure el divergit


def test_diff_page_identical_no_action():
    body = "# Tema\nMateix contingut exacte"
    d = diff_page(body, body)
    assert d["body_status"] == "identical"
    assert d["safe_action"] == "none"


def test_match_pages_by_id_then_title():
    notion = [{"id": "103268e5-2714-8069-9ec2-e8121dae22c5", "title": "Ocio"},
              {"id": "xxxx", "title": "Projectes"},
              {"id": "yyyy", "title": "Només a Notion"}]
    vault = [{"id": "103268e527148069 9ec2e8121dae22c5".replace(" ", ""), "title": "Oci"},  # mateix id sense guions
             {"id": "different-id", "title": "Projectes"},                                    # casa per títol
             {"id": "zzzz", "title": "Només al vault"}]
    res = match_pages(notion, vault)
    matched_titles = {(n["title"], v["title"]) for n, v in res["matched"]}
    assert ("Ocio", "Oci") in matched_titles          # per id (conserva l'id de Notion)
    assert ("Projectes", "Projectes") in matched_titles  # per títol
    assert [n["title"] for n in res["notion_only"]] == ["Només a Notion"]
    assert [v["title"] for v in res["vault_only"]] == ["Només al vault"]


def test_headings_extracted():
    assert headings("# A\ntext\n## B\n### C") == ["A", "B", "C"]


if __name__ == "__main__":
    import traceback
    fns = [v for k, v in dict(globals()).items() if k.startswith("test_")]
    failed = 0
    for fn in fns:
        try:
            fn(); print(f"PASS {fn.__name__}")
        except Exception:
            failed += 1; print(f"FAIL {fn.__name__}"); traceback.print_exc()
    print(f"\n{len(fns) - failed}/{len(fns)} OK")
    sys.exit(1 if failed else 0)
