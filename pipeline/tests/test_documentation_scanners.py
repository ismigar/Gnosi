"""Documentation scanner fixtures contain synthetic source only."""

from __future__ import annotations

import json
import subprocess
import tokenize
from collections.abc import Callable, Iterator
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


@pytest.mark.parametrize(
    ("source", "expected"),
    [
        ("", (0, 0)),
        ('// ASCII\n/* ASCII */\nconst value = "ASCII";', (0, 0)),
        ("à é", (0, 0)),
        ("// à é\n// é", (2, 0)),
        ("/* à */ /* é */", (1, 0)),
        ("/* à\n é\nASCII */ // ó", (3, 0)),
        ("/* à\n é", (2, 0)),
        ("/* à*", (1, 0)),
        ("/** à */", (1, 0)),
        ('"àé";\'ç\';`ñ`', (0, 4)),
        ('"\\àé"', (0, 1)),
        ('"à\\"é" // ó', (1, 2)),
        ('"à\n é" // ó', (1, 2)),
        ('"à\\\n é" // ó', (1, 2)),
        ('`à ${ /* é */ "ó" }` // ç', (1, 3)),
        ('"// à /* é */"', (0, 2)),
        ('// "à" /* é */', (1, 0)),
        ("/à/", (0, 0)),
        ("// à\r// é", (1, 0)),
        ("/* à\r é */", (1, 0)),
        ('"à\\', (0, 1)),
        ('"à', (0, 1)),
        ("/*/à", (1, 0)),
        ("// à\n/* é */", (2, 0)),
        ('/* ASCII */ "à" // é', (1, 1)),
    ],
)
def test_cstyle_preserves_approximate_counts(
    source: str, expected: tuple[int, int],
) -> None:
    assert scope.scan_cstyle(source) == expected


@pytest.fixture
def ordered_audit_source() -> str:
    return (
        '"""pàgina usuari"""\n'
        '# archivo usuario\n'
        '# "pàgina usuari"\n'
        '# pàgina usuari @language-example\n'
        'label = "pàgina usuari"\n'
        'state = "Estat"\n'
        'logger.info("pàgina usuari", f"archivo {value} usuario", 42, "", '
        'extra="archivo usuario")\n'
        'obj.logger.info("archivo usuario")\n'
        'log.trace("archivo usuario")\n'
        'print("archivo usuario")\n'
        'def outer():\n'
        '    """pàgina usuari"""\n'
        '    log.error(f"pàgina {value} usuari")\n'
        '    async def inner():\n'
        '        """archivo usuario @language-example"""\n'
        '        return f"pàgina {\'archivo usuario\'} usuari"\n'
        'class Example:\n'
        '    """archivo usuario"""\n'
    )


@pytest.mark.parametrize("inspect_strings", [False, True])
def test_audit_preserves_output_bytes_and_ast_order(
    tmp_path: Path, capsys: pytest.CaptureFixture[str],
    ordered_audit_source: str, inspect_strings: bool,
) -> None:
    path = tmp_path / "fixture.py"
    path.write_text(ordered_audit_source, encoding="utf-8")
    expected = [
        "2:comment:es:# archivo usuario",
        "1:docstring:ca:pàgina usuari",
        "12:docstring:ca:pàgina usuari",
        "18:docstring:es:archivo usuario",
        "7:logger.info:ca:pàgina usuari",
        "7:logger.info:es:archivo usuario",
        "13:log.error:ca:pàgina usuari",
    ]
    if inspect_strings:
        expected.extend([
            "5:runtime-string:ca:pàgina usuari",
            "8:runtime-string:es:archivo usuario",
            "9:runtime-string:es:archivo usuario",
            "10:runtime-string:es:archivo usuario",
            "7:runtime-string:es:archivo usuario",
            "16:runtime-string:ca:pàgina usuari",
        ])
    assert audit.scan_python(path, inspect_strings=inspect_strings) == len(expected)
    output = capsys.readouterr()
    assert output.out.encode() == "".join(f"{path}:{line}\n" for line in expected).encode()
    assert output.err == ""


@pytest.mark.parametrize("inspect_strings", [False, True])
def test_audit_preserves_detector_payload_and_late_bound_report(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
    ordered_audit_source: str, inspect_strings: bool,
) -> None:
    path = tmp_path / "fixture.py"
    path.write_text(ordered_audit_source, encoding="utf-8")
    detector_path = tmp_path / "never-executed"
    expected_texts = [
        "# archivo usuario", "#  ", "pàgina usuari", "pàgina usuari",
        "archivo usuario", "pàgina usuari", "archivo   usuario", "pàgina   usuari",
    ]
    if inspect_strings:
        expected_texts.extend([
            "pàgina usuari", "archivo usuario", "archivo usuario",
            "archivo usuario", "archivo usuario", "pàgina   usuari",
        ])
    reports: list[tuple[Path, int, str, str, str]] = []
    calls: list[list[str]] = []

    def replacement_report(
        path: Path, line: int, kind: str, text: str, language: str,
    ) -> None:
        reports.append((path, line, kind, text, language))

    def detector(texts: list[str], language_detector: Path | None) -> list[str | None]:
        assert texts == expected_texts
        assert language_detector is detector_path
        calls.append(texts)
        monkeypatch.setattr(audit, "report", replacement_report)
        return ["es"] + [None] * (len(texts) - 1)

    monkeypatch.setattr(audit, "detected_languages", detector)
    assert audit.scan_python(
        path, inspect_strings=inspect_strings, language_detector=detector_path,
    ) == 1
    assert calls == [expected_texts]
    assert reports == [(path, 2, "comment", "# archivo usuario", "es")]


@pytest.mark.parametrize(
    ("source", "expected"),
    [
        ("# pàgina usuari\nvalue =\n", 1),
        ('# pàgina usuari\nvalue = "unterminated\n', 1),
        ("# pàgina usuari\nvalue = (\n", 0),
        ('# pàgina usuari\nvalue = """\n', 0),
        ("# pàgina usuari\nif True:\n    pass\n  pass\n", 0),
    ],
)
def test_audit_preserves_parse_and_tokenization_fallbacks(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], source: str, expected: int,
) -> None:
    path = tmp_path / "fixture.py"
    path.write_text(source, encoding="utf-8")
    assert audit.scan_python(path, inspect_strings=True) == expected
    assert capsys.readouterr().out == (
        f"{path}:1:comment:ca:# pàgina usuari\n" if expected else ""
    )


@pytest.mark.parametrize(
    ("source", "expected"),
    [("# candidate\npass\n", 1), ("# candidate\nvalue =\n", 2)],
)
def test_audit_retains_distinct_fallback_counting_for_callback_results(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str],
    source: str, expected: int,
) -> None:
    path = tmp_path / "fixture.py"
    path.write_text(source, encoding="utf-8")

    def detector(texts: list[str], language_detector: Path | None) -> list[str | None]:
        assert texts == ["# candidate"]
        return ["ca", "es"]

    monkeypatch.setattr(audit, "detected_languages", detector)
    assert audit.scan_python(path) == expected
    assert capsys.readouterr().out == f"{path}:1:comment:ca:# candidate\n"


def test_audit_propagates_unexpected_tokenizer_errors(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    path = tmp_path / "fixture.py"
    path.write_text("# candidate\n", encoding="utf-8")
    failure = RuntimeError("synthetic tokenizer failure")

    def fail_tokenizer(readline: Callable[[], str]) -> Iterator[tokenize.TokenInfo]:
        raise failure

    monkeypatch.setattr(tokenize, "generate_tokens", fail_tokenizer)
    with pytest.raises(RuntimeError) as caught:
        audit.scan_python(path)
    assert caught.value is failure


@pytest.mark.parametrize(
    "literal",
    [
        repr("Estat"), repr(r"[\w pàgina usuari"), repr(r"\b(pàgina usuari"),
        repr('<?xml xmlns:cal="pàgina usuari"?>'), '""', 'f"{value}"',
    ],
)
def test_audit_skips_intentional_runtime_data_and_empty_fstrings(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], literal: str,
) -> None:
    path = tmp_path / "fixture.py"
    path.write_text(f"value = {literal}\n", encoding="utf-8")
    assert audit.scan_python(path, inspect_strings=True) == 0
    assert capsys.readouterr().out == ""


def test_audit_excludes_entire_log_arguments_but_keeps_keywords(
    tmp_path: Path, capsys: pytest.CaptureFixture[str],
) -> None:
    path = tmp_path / "fixture.py"
    path.write_text(
        'logger.warning(make("pàgina usuari"), ["archivo usuario"], '
        'extra="archivo usuario")\n', encoding="utf-8",
    )
    assert audit.scan_python(path, inspect_strings=True) == 1
    assert capsys.readouterr().out == f"{path}:1:runtime-string:es:archivo usuario\n"


@pytest.mark.parametrize(
    ("response", "expected_error"),
    [
        ("not JSON", json.JSONDecodeError),
        ("[]", RuntimeError),
        ("[[1]]", TypeError),
    ],
)
def test_audit_preserves_detector_failures_without_running_a_detector(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
    response: str, expected_error: type[Exception],
) -> None:
    path = tmp_path / "fixture.py"
    path.write_text("# pàgina usuari\n", encoding="utf-8")
    detector_path = tmp_path / "never-executed"

    def fake_run(
        args: list[str], *, input: str, text: bool, capture_output: bool, check: bool,
    ) -> subprocess.CompletedProcess[str]:
        assert args == [str(detector_path)]
        assert input == '["# pàgina usuari"]'
        assert text and capture_output and check
        return subprocess.CompletedProcess(args, 0, stdout=response)

    monkeypatch.setattr(subprocess, "run", fake_run)
    with pytest.raises(expected_error) as caught:
        audit.scan_python(path, language_detector=detector_path)
    if expected_error is RuntimeError:
        assert str(caught.value) == "Language detector returned an invalid response"


def test_audit_preserves_external_process_error_identity_without_execution(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    path = tmp_path / "fixture.py"
    path.write_text("# candidate\n", encoding="utf-8")
    failure = subprocess.CalledProcessError(7, "synthetic-detector", stderr="failure")

    def fail_run(
        args: list[str], *, input: str, text: bool, capture_output: bool, check: bool,
    ) -> subprocess.CompletedProcess[str]:
        raise failure

    monkeypatch.setattr(subprocess, "run", fail_run)
    with pytest.raises(subprocess.CalledProcessError) as caught:
        audit.scan_python(path, language_detector=tmp_path / "never-executed")
    assert caught.value is failure


def test_scope_inventory_keeps_sorting_and_exact_json_bytes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str],
) -> None:
    contents = {
        "b.ts": '// à\n"ñ";\n',
        "a.ts": "// é\n",
        "c.py": '# à\n"""é"""\n',
        "data.ts": '"à";\n',
    }
    for name, source in contents.items():
        (tmp_path / name).write_text(source, encoding="utf-8")
    monkeypatch.setattr(scope, "ROOT", str(tmp_path))
    monkeypatch.setattr(scope, "iter_files", lambda: iter(str(tmp_path / n) for n in contents))
    scope.main()
    output = capsys.readouterr()
    assert output.out.encode() == (
        '[{"path": "c.py", "ext": ".py", "comment_hits": 1, "docstring_hits": 1, '
        '"doc_hits": 2, "string_hits": 0}, '
        '{"path": "a.ts", "ext": ".ts", "comment_hits": 1, "docstring_hits": 0, '
        '"doc_hits": 1, "string_hits": 0}, '
        '{"path": "b.ts", "ext": ".ts", "comment_hits": 1, "docstring_hits": 0, '
        '"doc_hits": 1, "string_hits": 1}]\n'
    ).encode()
    assert output.err == (
        "\n=== FILES NEEDING DOC TRANSLATION: 3 (total doc-hit lines: 4) ===\n"
        "   1 files,     2 hits  c.py\n"
        "   1 files,     1 hits  a.ts\n"
        "   1 files,     1 hits  b.ts\n"
    )
