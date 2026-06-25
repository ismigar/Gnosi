"""Tests dels helpers PURS del cinturó d'eines de coneixement (sense backend)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from agent.vault_tools import (  # noqa: E402
    build_page_frontmatter, build_cornell_note, rank_link_candidates,
    _parse_cornell_json, VAULT_KNOWLEDGE_TOOLS,
)


def test_frontmatter_has_title_and_id():
    fm = build_page_frontmatter("La meva nota", {"tags": ["a", "b"]})
    assert "title: La meva nota" in fm
    assert "id:" in fm
    assert "tags:" in fm
    # respecta un id existent
    fm2 = build_page_frontmatter("X", {"id": "fixed-123"})
    assert "fixed-123" in fm2


def test_cornell_structure():
    md = build_cornell_note("Tema", cues=["Què és X?", "Per què Y?"],
                            notes="Cos de les notes.", summary="En resum, Z.")
    assert "# Tema" in md
    assert "## 📝 Notes" in md and "Cos de les notes." in md
    assert "## 🔑 Pistes / preguntes" in md
    assert "- Què és X?" in md and "- Per què Y?" in md
    assert "## 🧭 Resum" in md and "En resum, Z." in md


def test_cornell_empty_cues():
    md = build_cornell_note("T", cues=[], notes="n", summary="s")
    assert "_—_" in md  # placeholder quan no hi ha pistes


def test_rank_link_candidates_orders_by_overlap():
    page = "El sistema de routing de models decideix per cost i tokens disponibles"
    cands = [
        {"title": "Routing de models", "content": "routing cost tokens models decideix"},
        {"title": "Recepta de pa", "content": "farina aigua llevat forn"},
        {"title": "Tokens i cost", "content": "tokens cost pressupost"},
    ]
    ranked = rank_link_candidates(page, cands, top_k=5)
    titles = [r["title"] for r in ranked]
    assert "Routing de models" in titles
    assert "Recepta de pa" not in titles  # sense solapament → fora
    # el de més solapament va primer
    assert ranked[0]["title"] == "Routing de models"
    assert all("score" in r for r in ranked)


def test_rank_empty_page():
    assert rank_link_candidates("", [{"title": "x", "content": "y"}]) == []


def test_parse_cornell_json_ok():
    text = '```json\n{"notes":"cos","cues":["q1","q2"],"summary":"resum"}\n```'
    notes, cues, summary = _parse_cornell_json(text)
    assert notes == "cos" and cues == ["q1", "q2"] and summary == "resum"


def test_parse_cornell_json_degrades_to_plaintext():
    notes, cues, summary = _parse_cornell_json("només text pla sense json")
    assert notes == "només text pla sense json" and cues == [] and summary == ""


def test_parse_cornell_cues_as_string():
    notes, cues, _ = _parse_cornell_json('{"notes":"n","cues":"q1\\nq2","summary":"s"}')
    assert cues == ["q1", "q2"]


def test_tools_exported():
    names = [getattr(t, "name", getattr(t, "__name__", "")) for t in VAULT_KNOWLEDGE_TOOLS]
    assert any("read_page" in n for n in names)
    assert any("create_page" in n for n in names)
    assert len(VAULT_KNOWLEDGE_TOOLS) == 5


if __name__ == "__main__":
    import traceback
    fns = [v for k, v in dict(globals()).items() if k.startswith("test_")]
    failed = 0
    for fn in fns:
        try:
            fn()
            print(f"PASS {fn.__name__}")
        except Exception:
            failed += 1
            print(f"FAIL {fn.__name__}")
            traceback.print_exc()
    print(f"\n{len(fns) - failed}/{len(fns)} OK")
    sys.exit(1 if failed else 0)
