"""The native mypy parser must preserve complete strict backend diagnostics."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest
from mypy.main import process_options

from scripts.check_backend_types import ARGUMENTS as CHECKER_ARGUMENTS

ARGUMENTS = ["--strict", "--exclude", "^backend/tests/", "backend"]
CHECKER = Path(__file__).resolve().parents[2] / "scripts/check_backend_types.py"


def run_mypy(root: Path, native: bool) -> subprocess.CompletedProcess[str]:
    environment = dict(os.environ, MYPY_CACHE_DIR=str(root / f"cache-{native}"))
    environment.pop("MYPYPATH", None)
    if not native:
        environment.pop("MYPY_NUM_WORKERS", None)
    if native:
        checker = root / "scripts/check_backend_types.py"
        checker.parent.mkdir(exist_ok=True)
        shutil.copyfile(CHECKER, checker)
        command = [sys.executable, str(checker)]
    else:
        command = [sys.executable, "-m", "mypy", "--no-native-parser", *ARGUMENTS]
    return subprocess.run(
        command,
        cwd=root, env=environment, text=True, capture_output=True, timeout=60,
    )


def write_sources(root: Path, files: dict[str, str]) -> None:
    for name, contents in {"backend/__init__.py": "", **files}.items():
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(contents)


CASES = [
    pytest.param({"backend/app.py": "def twice(value: int) -> int:\n    return value * 2\n"},
                 0, [], id="valid"),
    pytest.param({"backend/app.py": "def value() -> int:\n    return 'bad'\n"},
                 1, ["[return-value]"], id="return-value"),
    pytest.param({"backend/app.py": "def value(arg):\n    return arg\n"},
                 1, ["[no-untyped-def]"], id="untyped-function"),
    pytest.param({"backend/app.py": "from typing import Any, cast\n"
                 "def value(arg: Any) -> int:\n    item: list = []\n"
                 "    unused = cast(int, 1)\n    return arg\n"
                 "ok: int = 1  # type: ignore\n"},
                 1, ["[type-arg]", "[redundant-cast]", "[no-any-return]",
                     "[unused-ignore]"], id="strict-diagnostics"),
    pytest.param({"backend/a.py": "from backend.b import convert\n"
                 "def use() -> int:\n    return convert('bad')\n",
                 "backend/b.py": "from backend.a import use\n"
                 "def convert(value: int) -> int:\n    return value\n"},
                 1, ["[arg-type]"], id="cyclic-import"),
    pytest.param({"backend/value.py": "def read() -> int:\n    return 1\n",
                 "backend/value.pyi": "def read() -> str: ...\n",
                 "backend/use.py": "from backend.value import read\nresult: int = read()\n"},
                 1, ["[assignment]"], id="stub-precedence"),
    pytest.param({"backend/app.py": "value: int = 1\n",
                 "backend/tests/broken.py": "def syntax(:\n",
                 "backend/unimported.py": "value: int = 'bad'\n"},
                 1, ["[assignment]"], id="unimported-root-and-excluded-tests"),
    pytest.param({"backend/app.py": "from nonexistent_fixture_module import value\n"},
                 1, ["[import-not-found]"], id="missing-import"),
    pytest.param({"backend/app.py": "from typing import TypedDict\n"
                 "class Row(TypedDict):\n    value: int\n"
                 "def read(row: Row) -> int:\n    match row:\n"
                 "        case {'value': value}:\n            return value\n"
                 "    return 0\nrow: Row = {'value': 'bad'}\n"},
                 1, ["[typeddict-item]"], id="match-and-typed-dict"),
    pytest.param({"backend/app.py": "async def read(value: int) -> int:\n    return value\n"
                 "async def use() -> str:\n    return await read('bad')\n"},
                 1, ["[return-value]", "[arg-type]"], id="async"),
    pytest.param({"backend/app.py": "from typing import no_type_check\n"
                 "@no_type_check\ndef ignored(value):\n    return 'bad'\n"
                 "value: int = 'bad'  # type: ignore[assignment]\n"},
                 0, [], id="explicit-ignores"),
]


@pytest.mark.parametrize("files,status,codes", CASES)
def test_real_parsers_report_the_same_strict_diagnostics(
    tmp_path: Path, files: dict[str, str], status: int, codes: list[str],
) -> None:
    write_sources(tmp_path, files)
    legacy, native = run_mypy(tmp_path, False), run_mypy(tmp_path, True)
    assert legacy.returncode == native.returncode == status, (legacy, native)
    assert legacy.stdout == native.stdout, (legacy.stdout, native.stdout)
    assert legacy.stderr == native.stderr == ""
    for code in codes:
        assert code in native.stdout


def test_source_discovery_and_every_non_parser_option_are_identical(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    write_sources(tmp_path, {"backend/app.py": "value: int = 1\n",
                            "backend/tests/broken.py": "def syntax(:\n",
                            "backend/nested/__init__.py": "",
                            "backend/nested/stub.pyi": "value: int\n"})
    monkeypatch.chdir(tmp_path)
    legacy_sources, legacy = process_options(["--no-native-parser", *ARGUMENTS])
    native_sources, native = process_options(CHECKER_ARGUMENTS)
    assert [(s.path, s.module, s.base_dir) for s in legacy_sources] == [
        (s.path, s.module, s.base_dir) for s in native_sources
    ]
    assert {s.path for s in native_sources} == {
        "backend/__init__.py", "backend/app.py", "backend/nested/__init__.py",
        "backend/nested/stub.pyi",
    }
    legacy_options, native_options = legacy.snapshot(), native.snapshot()
    assert legacy_options.pop("native_parser") is False
    assert native_options.pop("native_parser") is True
    assert legacy_options == native_options


def test_invalid_syntax_still_fails(tmp_path: Path) -> None:
    write_sources(tmp_path, {"backend/app.py": "def syntax(:\n"})
    for native in (False, True):
        result = run_mypy(tmp_path, native)
        assert result.returncode == 2
        assert "[syntax]" in result.stdout


def test_incremental_cache_cannot_hide_a_new_error(tmp_path: Path) -> None:
    write_sources(tmp_path, {"backend/app.py": "value: int = 1\n"})
    for native in (False, True):
        assert run_mypy(tmp_path, native).returncode == 0
    (tmp_path / "backend/app.py").write_text("value: int = 'bad'\n")
    legacy, native = run_mypy(tmp_path, False), run_mypy(tmp_path, True)
    assert legacy.returncode == native.returncode == 1
    assert legacy.stdout == native.stdout
    assert "[assignment]" in native.stdout


@pytest.mark.parametrize("missing", [False, True])
def test_empty_or_missing_target_never_passes(tmp_path: Path, missing: bool) -> None:
    if not missing:
        (tmp_path / "backend").mkdir()
    for native in (False, True):
        assert run_mypy(tmp_path, native).returncode == 2


def test_actual_native_parser_pool_is_single_threaded(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    write_sources(tmp_path, {"backend/app.py": "value: int = 1\n"})
    (tmp_path / "mypy.ini").write_text("[mypy]\nplugins = pool_probe.py\n")
    (tmp_path / "pool_probe.py").write_text(
        "import json\nfrom pathlib import Path\n"
        "from concurrent.futures import ThreadPoolExecutor\n"
        "from mypy.plugin import Plugin\n"
        "original = ThreadPoolExecutor.submit\n"
        "def submit(self, *args, **kwargs):\n"
        "    with Path('pool.jsonl').open('a') as output:\n"
        "        output.write(json.dumps(self._max_workers) + '\\n')\n"
        "    return original(self, *args, **kwargs)\n"
        "ThreadPoolExecutor.submit = submit\n"
        "def plugin(version):\n    return Plugin\n"
    )
    # An inherited worker request must not enable mypy's process pool either.
    monkeypatch.setenv("MYPY_NUM_WORKERS", "8")
    result = run_mypy(tmp_path, True)
    assert result.returncode == 0, result
    counts = [json.loads(line) for line in (tmp_path / "pool.jsonl").read_text().splitlines()]
    assert counts and set(counts) == {1}


@pytest.mark.parametrize("location", ["backend/services/handwriting.py", "backend/unimported.py"])
def test_priming_never_hides_an_error_in_either_phase(tmp_path: Path, location: str) -> None:
    write_sources(tmp_path, {"backend/services/__init__.py": "",
                            "backend/services/handwriting.py": "value: int = 1\n",
                            "backend/unimported.py": "value: int = 1\n"})
    (tmp_path / location).write_text("value: int = 'bad'\n")
    result = run_mypy(tmp_path, True)
    assert result.returncode == 1, result
    assert location + ":1: error:" in result.stdout
    assert "[assignment]" in result.stdout


def test_private_cache_and_mandatory_complete_phase(tmp_path: Path) -> None:
    write_sources(tmp_path, {"backend/services/__init__.py": "",
                            "backend/services/handwriting.py": "value: int = 1\n",
                            "backend/unimported.py": "value: int = 1\n"})
    (tmp_path / "mypy.ini").write_text("[mypy]\nplugins = cache_probe.py\n")
    (tmp_path / "cache_probe.py").write_text(
        "import json, os\nfrom pathlib import Path\nfrom mypy.plugin import Plugin\n"
        "class Probe(Plugin):\n"
        "    def __init__(self, options):\n"
        "        super().__init__(options)\n"
        "        with Path('cache.jsonl').open('a') as output:\n"
        "            output.write(json.dumps([os.getpid(), options.cache_dir]) + '\\n')\n"
        "def plugin(version):\n    return Probe\n"
    )
    # A poisoned inherited cache must neither affect acceptance nor be replaced.
    inherited = tmp_path / "cache-True"
    inherited.write_text("not a cache directory\n")
    result = run_mypy(tmp_path, True)
    assert result.returncode == 0, result
    assert "Success: no issues found in 1 source file" in result.stdout
    assert result.stdout.endswith("Success: no issues found in 4 source files\n")
    calls = [json.loads(line) for line in (tmp_path / "cache.jsonl").read_text().splitlines()]
    assert len(calls) == 2 and calls[0][0] != calls[1][0]
    assert calls[0][1] == calls[1][1]
    assert calls[0][1] != str(tmp_path / "cache-True")
    assert not Path(calls[0][1]).exists()
    assert inherited.read_text() == "not a cache directory\n"


@pytest.mark.parametrize("configuration,source", [
    ("[mypy]\npython_version = 3.10\n", "try:\n    pass\nexcept* Exception:\n    pass\n"),
    ("[mypy]\npython_version = nonsense\n", "value: int = 'bad'\n"),
])
def test_target_version_and_bad_config_diagnostics_are_preserved(
    tmp_path: Path, configuration: str, source: str,
) -> None:
    write_sources(tmp_path, {"backend/app.py": source})
    (tmp_path / "mypy.ini").write_text(configuration)
    legacy, native = run_mypy(tmp_path, False), run_mypy(tmp_path, True)
    assert legacy.returncode == native.returncode != 0, (legacy, native)
    assert legacy.stdout == native.stdout
    assert legacy.stderr == native.stderr


def test_discovery_prefers_a_seed_stub_over_its_implementation(tmp_path: Path) -> None:
    write_sources(tmp_path, {"backend/services/__init__.py": "",
                            "backend/services/handwriting.py": "def syntax(:\n",
                            "backend/services/handwriting.pyi": "value: int\n",
                            "backend/app.py": "from backend.services.handwriting import value\n"
                            "result: str = value\n"})
    legacy, native = run_mypy(tmp_path, False), run_mypy(tmp_path, True)
    assert legacy.returncode == native.returncode == 1
    assert "backend/app.py:2: error:" in native.stdout
    assert "[assignment]" in native.stdout and "[syntax]" not in native.stdout


def test_final_roots_recheck_silently_primed_imports(tmp_path: Path) -> None:
    write_sources(tmp_path, {"backend/services/__init__.py": "",
                            "backend/services/handwriting.py": "from backend.other import value\n",
                            "backend/other.py": "value: int = 'bad'\n"})
    (tmp_path / "mypy.ini").write_text("[mypy]\nfollow_imports = silent\n")
    legacy, native = run_mypy(tmp_path, False), run_mypy(tmp_path, True)
    assert legacy.returncode == native.returncode == 1
    assert native.stdout.startswith("Success: no issues found in 1 source file\n")
    assert native.stdout.removeprefix("Success: no issues found in 1 source file\n") == legacy.stdout


def test_source_edits_with_unchanged_size_and_mtime_fail_closed(tmp_path: Path) -> None:
    write_sources(tmp_path, {"backend/services/__init__.py": "",
                            "backend/services/handwriting.py": "value: int = 1\n",
                            "backend/other.py": "value: int = 1\n"})
    (tmp_path / "mypy.ini").write_text("[mypy]\nplugins = mutation_probe.py\n")
    (tmp_path / "mutation_probe.py").write_text(
        "import os\nfrom pathlib import Path\nfrom mypy.plugin import Plugin\n"
        "def plugin(version):\n"
        "    path = Path('backend/other.py')\n"
        "    stat = path.stat()\n"
        "    path.write_text(path.read_text().replace('= 1', '= 2'))\n"
        "    os.utime(path, ns=(stat.st_atime_ns, stat.st_mtime_ns))\n"
        "    return Plugin\n"
    )
    result = run_mypy(tmp_path, True)
    assert result.returncode != 0
    assert "Backend sources/configuration changed during checking" in result.stderr
    assert "Success: no issues found in 4 source files" not in result.stdout


def test_terminated_prime_worker_cannot_establish_success(tmp_path: Path) -> None:
    write_sources(tmp_path, {"backend/services/__init__.py": "",
                            "backend/services/handwriting.py": "value: int = 1\n"})
    (tmp_path / "mypy.ini").write_text("[mypy]\nplugins = signal_probe.py\n")
    (tmp_path / "signal_probe.py").write_text(
        "import os, signal\nfrom mypy.plugin import Plugin\n"
        "def plugin(version):\n"
        "    os.kill(os.getpid(), signal.SIGTERM)\n"
        "    return Plugin\n"
    )
    result = run_mypy(tmp_path, True)
    assert result.returncode == 143
    assert "Success:" not in result.stdout


@pytest.mark.parametrize("mode", ["skip", "error"])
def test_root_sensitive_import_modes_keep_the_authoritative_full_context(
    tmp_path: Path, mode: str,
) -> None:
    write_sources(tmp_path, {
        "backend/services/__init__.py": "",
        "backend/services/handwriting.py": "from backend.other import value\n"
        "def read() -> int:\n    return value()\n",
        "backend/other.py": "def value() -> int:\n    return 1\n",
    })
    (tmp_path / "mypy.ini").write_text(f"[mypy]\nfollow_imports = {mode}\n")
    legacy, native = run_mypy(tmp_path, False), run_mypy(tmp_path, True)
    assert legacy.returncode == native.returncode == 0, (legacy, native)
    assert legacy.stdout == native.stdout and legacy.stderr == native.stderr


def test_config_warning_is_reported_once_with_a_seed(tmp_path: Path) -> None:
    write_sources(tmp_path, {"backend/services/__init__.py": "",
                            "backend/services/handwriting.py": "value: int = 1\n"})
    (tmp_path / "mypy.ini").write_text("[mypy]\npython_version = nonsense\n")
    legacy, native = run_mypy(tmp_path, False), run_mypy(tmp_path, True)
    assert legacy.returncode == native.returncode == 0
    assert legacy.stdout == native.stdout and legacy.stderr == native.stderr
    assert native.stderr.count("Invalid python version") == 1


def test_configured_import_outside_repository_is_fingerprinted(tmp_path: Path) -> None:
    external = tmp_path.parent / (tmp_path.name + "-external")
    external.mkdir()
    (external / "external.pyi").write_text("value: int\n")
    write_sources(tmp_path, {"backend/services/__init__.py": "",
                            "backend/services/handwriting.py": "from external import value\n"
                            "result: int = value\n",
                            "backend/app.py": "from external import value\nresult: int = value\n"})
    (tmp_path / "mypy.ini").write_text(
        f"[mypy]\nmypy_path = {external}\nplugins = external_mutation_probe.py\n"
    )
    (tmp_path / "external_mutation_probe.py").write_text(
        "import os\nfrom pathlib import Path\nfrom mypy.plugin import Plugin\n"
        "def plugin(version):\n"
        "    flag = Path('mutated')\n"
        "    if flag.exists():\n"
        f"        path = Path({str(external / 'external.pyi')!r})\n"
        "        stat = path.stat()\n"
        "        path.write_text('value: str\\n')\n"
        "        os.utime(path, ns=(stat.st_atime_ns, stat.st_mtime_ns))\n"
        "    else:\n        flag.touch()\n"
        "    return Plugin\n"
    )
    result = run_mypy(tmp_path, True)
    assert result.returncode != 0
    assert "Backend sources/configuration changed during checking" in result.stderr
