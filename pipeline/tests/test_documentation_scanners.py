"""Documentation scanner fixtures contain synthetic source only."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from pipeline.scripts import audit_python_docs_english as audit
from pipeline.scripts import scope_code_docs as scope


def test_python_scope_distinguishes_comments_docstrings_and_data() -> None:
    source = '# pàgina\n"""dades"""\nvalue = "usuari à"\n'
    assert scope.scan_python("fixture.py", source) == (1, 0, 1)
    source = '# pàgina\n"""dades à"""\nvalue = "usuari à"\n'
    assert scope.scan_python("fixture.py", source) == (1, 1, 1)


def test_typescript_scope_keeps_comment_like_strings_outside_comments() -> None:
    source = 'const message = "// à"; // pàgina\n/* dades à\n més */\n'
    assert scope.scan_cstyle(source) == (3, 1)


def test_scope_cli_inventory_and_exclusions(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str],
) -> None:
    (tmp_path / "fixture.tsx").write_text('// pàgina\nconst label = "à";\n', encoding="utf-8")
    (tmp_path / "plain.py").write_text("# English comment\n", encoding="utf-8")
    excluded = tmp_path / "node_modules"
    excluded.mkdir()
    (excluded / "private.ts").write_text("// pàgina", encoding="utf-8")
    monkeypatch.setattr(scope, "ROOT", str(tmp_path))
    scope.main()
    output = capsys.readouterr()
    assert json.loads(output.out) == [{
        "path": "fixture.tsx", "ext": ".tsx", "comment_hits": 1,
        "docstring_hits": 0, "doc_hits": 1, "string_hits": 1,
    }]
    assert "total doc-hit lines: 1" in output.err


def test_english_audit_respects_data_examples_and_string_opt_in(
    tmp_path: Path, capsys: pytest.CaptureFixture[str],
) -> None:
    source = tmp_path / "fixture.py"
    source.write_text(
        '# pàgina usuari\n'
        '# "pàgina usuari" @language-example\n'
        'label = "pàgina usuari"\n'
        'state = "Estat"\n', encoding="utf-8",
    )
    assert audit.scan_python(source) == 1
    assert ":comment:ca:" in capsys.readouterr().out
    assert audit.scan_python(source, inspect_strings=True) == 2
    assert ":runtime-string:ca:pàgina usuari" in capsys.readouterr().out


def test_audit_discovery_excludes_generated_dependencies(tmp_path: Path) -> None:
    source = tmp_path / "fixture.py"
    source.write_text("# synthetic\n", encoding="utf-8")
    excluded = tmp_path / "node_modules"
    excluded.mkdir()
    (excluded / "dependency.py").write_text("# synthetic\n", encoding="utf-8")
    assert list(audit.iter_files(tmp_path, {".py"})) == [source]
    assert list(audit.iter_files(source, {".py"})) == [source]
    assert list(audit.iter_files(source, {".md"})) == []
