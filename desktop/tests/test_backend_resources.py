"""Synthetic resource/TOC/build-command contracts; never build or import Gnosi."""

from __future__ import annotations

import ast
import json
import os
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from types import ModuleType
from typing import cast

import pytest

from desktop.scripts import backend_resources as policy

ROOT = Path(__file__).resolve().parents[2]
HELPER = ROOT / "desktop/scripts/backend_resources.py"
BUILD = ROOT / "desktop/build-python.sh"


def write(root: Path, name: str, text: str = "synthetic runtime resource\n") -> Path:
    path = root / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


@pytest.fixture
def repository(tmp_path: Path) -> Path:
    root = tmp_path / "Gnosi's source with spaces $literal"
    for name in policy.DATA_FILES:
        write(root, name)
    write(root, "backend/migrations/alembic/script.py.mako", "revision = '${up_revision}'\n")
    for name in policy.MODULE_FILES + policy.DYNAMIC_MODULE_FILES:
        write(root, name, "raise AssertionError('source discovery must not import me')\n")
    for name in policy.MODULE_TREES:
        write(root, f"{name}/runtime.py", "raise AssertionError('do not import')\n")
    for name in (
        "backend/domains/mail/routes/messages.py",
        "backend/domains/configuration/api/credentials.py",
        "pipeline/skills/translate_row/scripts/translate_text.py",
        "pipeline/skills/translate_page/scripts/markdown_segmenter.py",
    ):
        write(root, name, "raise AssertionError('dynamically imported at runtime only')\n")
    return root


def make_bundle(tmp_path: Path, plan: policy.ResourcePlan, layout: str = "_internal") -> Path:
    bundle = tmp_path / "frozen output"
    payload = bundle / layout
    for name in plan.resources:
        destination = payload / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(plan.repository / name, destination)
    write(bundle, "cervell_backend", "synthetic executable; never executed")
    write(payload, "certifi/cacert.pem", "-----BEGIN CERTIFICATE-----\npublic certificate\n")
    write(payload, "base_library.zip", "synthetic dependency archive")
    write(payload, "libpython.dylib", "synthetic library")
    return bundle


def toc(plan: policy.ResourcePlan) -> tuple[list[policy.TocEntry], list[policy.TocEntry]]:
    data = [(name, str(plan.repository / name), "DATA") for name in plan.resources]
    modules = [
        (policy._module_name(name), str(plan.repository / name), "PYMODULE")
        for name in plan.module_files
    ]
    modules.append(("backend.data", "-", "PYMODULE"))
    return data, modules


def test_plan_keeps_required_runtime_without_importing_application(repository: Path) -> None:
    first = policy.build_plan(repository)
    assert policy.build_plan(repository) == first
    assert "backend.domains.mail.routes.messages" in first.modules
    assert "backend.domains.configuration.api.credentials" in first.modules
    assert "pipeline.skills.translate_row.scripts.translate_text" in first.modules
    assert "pipeline.skills.translate_page.scripts.markdown_segmenter" in first.modules
    assert "backend.server" in first.modules
    assert "backend/migrations/alembic/versions/management_0005.py" in first.resources
    assert "backend/migrations/alembic/script.py.mako" in first.resources
    assert "backend/agent/instructions/gnosy.md" in first.resources
    assert "backend/data/model_catalog.json" in first.resources
    assert "pipeline/skills/translate_row/SKILL.md" in first.resources
    assert "extensions/examples/clone-logger/backend.mjs" in first.resources
    assert "frontend/public/csl/styles/apa.csl" in first.resources
    assert all(Path(source).is_file() for source, _ in first.datas)
    assert (str(repository / "backend"), "backend") not in first.datas
    assert first.resources == tuple(sorted(first.resources))


def test_unselected_local_state_is_never_read_or_collected(
    repository: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    unselected = (
        "backend/.env",
        "backend/data/management.sqlite",
        "config/params.yaml",
        "pipeline/private_skills/secrets/integrations.json",
        "pipeline/skills/zotero_sync/zotero_db_config.json",
        "backend/agent/generated_tools/approved/private.py",
        "backend/config/__pycache__/local.pyc",
        "backend/config/tests/test_private.py",
        "backend/config/test_local.py",
        "backend/logs/server.log",
    )
    private_paths = {write(repository, name, "do not read") for name in unselected}
    original = Path.read_bytes

    def guarded(path: Path) -> bytes:
        assert path not in private_paths, "local content was opened"
        return original(path)

    monkeypatch.setattr(Path, "read_bytes", guarded)
    plan = policy.build_plan(repository)
    assert not set(unselected) & set(plan.resources + plan.module_files)


@pytest.mark.parametrize("name", policy.DATA_FILES)
def test_each_required_resource_missing_fails(repository: Path, name: str) -> None:
    (repository / name).unlink()
    with pytest.raises(policy.ResourcePolicyError, match="Required resource missing"):
        policy.build_plan(repository)


@pytest.mark.parametrize("name", policy.DYNAMIC_MODULE_FILES)
def test_missing_string_selected_module_fails(repository: Path, name: str) -> None:
    (repository / name).unlink()
    with pytest.raises(policy.ResourcePolicyError, match="Required resource missing"):
        policy.build_plan(repository)


@pytest.mark.parametrize(
    "name",
    (
        ".env",
        ".env.production",
        "secrets/oauth.json",
        "token.json",
        "credentials.json",
        "credentials.key",
        "client_secret_123.json",
        "params.yaml",
        "state.db",
        "state.db-wal",
        "state.sqlite3-shm",
        "server.log.1",
        "private.key",
        "private.pfx",
        "backups/file.json",
        "identity.json",
    ),
)
def test_selected_tree_prohibited_paths_fail_without_reading(
    repository: Path,
    name: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    forbidden = write(repository, f"backend/agent/instructions/{name}", "must not read")
    original = Path.read_bytes

    def guarded(path: Path) -> bytes:
        assert path != forbidden
        return original(path)

    monkeypatch.setattr(Path, "read_bytes", guarded)
    with pytest.raises(policy.ResourcePolicyError, match="Prohibited resource path"):
        policy.build_plan(repository)


def test_new_legitimate_template_requires_review_instead_of_silent_drop(repository: Path) -> None:
    write(repository, "backend/agent/instructions/new_template.html", "<p>{{ title }}</p>")
    with pytest.raises(policy.ResourcePolicyError, match="Unreviewed file"):
        policy.build_plan(repository)


@pytest.mark.parametrize(
    "content",
    (
        b"SQLite format 3\x00hidden database",
        b"-----BEGIN PRIVATE KEY-----\nsynthetic\n-----END PRIVATE KEY-----",
        b"-----BEGIN OPENSSH PRIVATE KEY-----\nsynthetic",
        b'{"refresh_token": "synthetic-secret-do-not-print"}',
        b'{"client_secret": "synthetic-secret-do-not-print"}',
        b'{"api_key": "synthetic-secret-do-not-print"}',
    ),
)
def test_prohibited_content_under_allowed_filename_fails_redacted(
    repository: Path,
    content: bytes,
) -> None:
    (repository / "backend/data/model_catalog.json").write_bytes(content)
    with pytest.raises(policy.ResourcePolicyError) as error:
        policy.build_plan(repository)
    assert "synthetic-secret-do-not-print" not in str(error.value)
    assert "model_catalog.json" in str(error.value)


def test_legitimate_template_placeholders_are_preserved(repository: Path) -> None:
    write(
        repository,
        "backend/agent/instructions/tool_development.md",
        """{"api_key": "{{ API_KEY }}", "password": "${PASSWORD}"}""",
    )
    policy.build_plan(repository)


@pytest.mark.parametrize(
    "target",
    (
        "backend/data/model_catalog.json",
        "backend/agent/instructions",
        "backend/config/runtime.py",
        "pipeline/skills/translate_row/scripts",
    ),
)
def test_selected_symlink_or_ancestor_cannot_escape(
    repository: Path,
    tmp_path: Path,
    target: str,
) -> None:
    original = repository / target
    moved = tmp_path / "external resource"
    original.rename(moved)
    original.symlink_to(moved, target_is_directory=moved.is_dir())
    with pytest.raises(policy.ResourcePolicyError, match="Symlink"):
        policy.build_plan(repository)


def test_analysis_supports_namespace_packages_and_dependency_resources(repository: Path) -> None:
    plan = policy.build_plan(repository)
    data, modules = toc(plan)
    data.append(("certifi/cacert.pem", "/synthetic-environment/certifi/cacert.pem", "DATA"))
    data.append(("base_library.zip", "/synthetic-work/base_library.zip", "DATA"))
    policy.validate_analysis(data, modules, [], plan)
    windows_destinations = [(name.replace("/", "\\"), source, kind) for name, source, kind in data]
    policy.validate_analysis(windows_destinations, modules, [], plan)


def test_analysis_keeps_relative_library_and_framework_links(repository: Path) -> None:
    plan = policy.build_plan(repository)
    data, modules = toc(plan)
    binaries = [
        ("libpython.dylib", "/synthetic-environment/libpython.dylib", "BINARY"),
        ("lib/libpython.dylib", "../libpython.dylib", "SYMLINK"),
        ("Python.framework/Versions/Current", "3.11", "SYMLINK"),
        ("Python.framework/Resources", "Versions/Current/Resources", "SYMLINK"),
    ]
    policy.validate_analysis(data, modules, binaries, plan)


@pytest.mark.parametrize(
    "name,target",
    (
        ("library-link", "../outside"),
        ("library-link", "/absolute"),
        ("library-link", "C:\\absolute"),
        ("library-link", "library-link"),
        ("lib/loop", ".."),
        ("alias", "backend/data/model_catalog.json"),
        ("backend/data/model_catalog.json", "third-party.json"),
    ),
)
def test_analysis_rejects_escaping_or_owned_links(
    repository: Path,
    name: str,
    target: str,
) -> None:
    plan = policy.build_plan(repository)
    data, modules = toc(plan)
    with pytest.raises(policy.ResourcePolicyError):
        policy.validate_analysis(data, modules, [(name, target, "SYMLINK")], plan)


@pytest.mark.parametrize(
    "destination",
    (
        "backend/.env",
        "backend/data/state.db",
        "../escape",
        "C:\\escape",
        "/absolute",
        "backend//extra",
        "backend/../extra",
        "backend\\data\\state.db",
        "backend/unknown.html",
        "config/params.yaml",
        "pipeline/private_skills/file.py",
        "backend/data/model_catalog.json:stream",
        "backend/new\nline",
        "token.json ",
        "backend/data/../secret.json",
        "backend/empty./template",
    ),
)
def test_hook_added_unsafe_data_is_rejected(repository: Path, destination: str) -> None:
    plan = policy.build_plan(repository)
    data, modules = toc(plan)
    data.append((destination, "/synthetic-hook/input", "DATA"))
    with pytest.raises(policy.ResourcePolicyError):
        policy.validate_analysis(data, modules, [], plan)


def test_hook_cannot_rename_unselected_repository_data(repository: Path) -> None:
    plan = policy.build_plan(repository)
    data, modules = toc(plan)
    data.append(("harmless.json", str(repository / "config/params.yaml"), "DATA"))
    with pytest.raises(policy.ResourcePolicyError, match="Unreviewed owned Analysis"):
        policy.validate_analysis(data, modules, [], plan)


def test_hook_cannot_substitute_required_resource(repository: Path) -> None:
    plan = policy.build_plan(repository)
    data, modules = toc(plan)
    data[0] = (data[0][0], "/synthetic-hook/substitution", "DATA")
    with pytest.raises(policy.ResourcePolicyError, match="Substituted Analysis"):
        policy.validate_analysis(data, modules, [], plan)


def test_analysis_rejects_case_collision(repository: Path) -> None:
    plan = policy.build_plan(repository)
    data, modules = toc(plan)
    data.append((data[0][0].upper(), data[0][1], "DATA"))
    with pytest.raises(policy.ResourcePolicyError, match="Colliding Analysis"):
        policy.validate_analysis(data, modules, [], plan)


@pytest.mark.parametrize("which", ("data", "module", "substituted-module", "unselected-module"))
def test_analysis_cannot_drop_or_substitute_runtime_modules_or_data(
    repository: Path,
    which: str,
) -> None:
    plan = policy.build_plan(repository)
    data, modules = toc(plan)
    if which == "data":
        data.pop()
    elif which == "module":
        modules.pop(0)
    elif which == "substituted-module":
        modules[0] = (modules[0][0], modules[1][1], "PYMODULE")
    else:
        modules.append(
            ("backend.local_secrets", str(repository / "backend/local_secrets.py"), "PYMODULE")
        )
    with pytest.raises(policy.ResourcePolicyError):
        policy.validate_analysis(data, modules, [], plan)


@pytest.mark.parametrize("layout", ("_internal", "."))
def test_bundle_keeps_legitimate_data_and_dependency_certificates(
    repository: Path,
    tmp_path: Path,
    layout: str,
) -> None:
    plan = policy.build_plan(repository)
    bundle = make_bundle(tmp_path, plan, layout)
    policy.verify_bundle(bundle, plan)
    assert (bundle / layout / "backend/migrations/alembic/script.py.mako").is_file()


@pytest.mark.parametrize("name", policy.DATA_FILES)
def test_bundle_cannot_omit_required_resources(repository: Path, tmp_path: Path, name: str) -> None:
    plan = policy.build_plan(repository)
    bundle = make_bundle(tmp_path, plan)
    (bundle / "_internal" / name).unlink()
    with pytest.raises(policy.ResourcePolicyError, match="missing required resources"):
        policy.verify_bundle(bundle, plan)


@pytest.mark.parametrize(
    "name",
    (
        "_internal/backend/data/user.db",
        "_internal/backend/data/extra.json",
        "_internal/backend/services/local.py",
        "_internal/backend/__pycache__/local.pyc",
        "_internal/pipeline/private_skills/file.py",
        "_internal/config/params.yaml",
        "_internal/.env",
        "_internal/server.log",
        "secrets/oauth.json",
        "_internal/backend/agent/instructions/new.html",
        "_internal/BACKEND/unreviewed.md",
        "_internal/backend/data/empty-user-directory/",
    ),
)
def test_bundle_contamination_fails_without_deleting_it(
    repository: Path,
    tmp_path: Path,
    name: str,
) -> None:
    plan = policy.build_plan(repository)
    bundle = make_bundle(tmp_path, plan)
    if name.endswith("/"):
        (bundle / name).mkdir()
    else:
        write(bundle, name)
    with pytest.raises(policy.ResourcePolicyError):
        policy.verify_bundle(bundle, plan)
    assert (bundle / name).exists()


def test_bundle_resource_modification_fails(repository: Path, tmp_path: Path) -> None:
    plan = policy.build_plan(repository)
    bundle = make_bundle(tmp_path, plan)
    write(bundle, "_internal/backend/data/model_catalog.json", "different safe-looking data")
    with pytest.raises(policy.ResourcePolicyError, match="Changed packaged resource"):
        policy.verify_bundle(bundle, plan)


def test_bundle_symlinks_are_scoped_to_dependency_files(repository: Path, tmp_path: Path) -> None:
    plan = policy.build_plan(repository)
    bundle = make_bundle(tmp_path, plan)
    (bundle / "_internal/libpython-link.dylib").symlink_to("libpython.dylib")
    policy.verify_bundle(bundle, plan)
    victim = bundle / "_internal/backend/data/model_catalog.json"
    victim.unlink()
    victim.symlink_to(repository / "backend/data/model_catalog.json")
    with pytest.raises(policy.ResourcePolicyError, match="Unsafe packaged symlink"):
        policy.verify_bundle(bundle, plan)


def test_bundle_external_dependency_link_fails(repository: Path, tmp_path: Path) -> None:
    plan = policy.build_plan(repository)
    bundle = make_bundle(tmp_path, plan)
    (bundle / "_internal/external").symlink_to(repository / "backend/data/model_catalog.json")
    with pytest.raises(policy.ResourcePolicyError, match="Unsafe packaged symlink"):
        policy.verify_bundle(bundle, plan)


def test_bundle_preserves_python_framework_directory_links(
    repository: Path, tmp_path: Path
) -> None:
    plan = policy.build_plan(repository)
    bundle = make_bundle(tmp_path, plan)
    framework = bundle / "_internal/Python.framework"
    write(framework, "Versions/3.11/Resources/Info.plist", "synthetic public framework info")
    write(framework, "Versions/3.11/Python", "synthetic framework binary")
    (framework / "Versions/Current").symlink_to("3.11", target_is_directory=True)
    (framework / "Resources").symlink_to("Versions/Current/Resources", target_is_directory=True)
    (framework / "Python").symlink_to("Versions/Current/Python")
    policy.verify_bundle(bundle, plan)


@pytest.mark.parametrize("target", ("cycle", "."))
def test_bundle_rejects_cycle_or_ancestor_links(
    repository: Path,
    tmp_path: Path,
    target: str,
) -> None:
    plan = policy.build_plan(repository)
    bundle = make_bundle(tmp_path, plan)
    (bundle / "_internal/cycle").symlink_to(target)
    with pytest.raises(policy.ResourcePolicyError, match="packaged symlink"):
        policy.verify_bundle(bundle, plan)


@pytest.mark.parametrize(
    "name,raw",
    (
        ("innocent.json", b"SQLite format 3\x00synthetic database"),
        ("private.pem", b"-----BEGIN RSA PRIVATE KEY-----\nsynthetic"),
    ),
)
def test_bundle_rejects_disguised_database_and_private_key(
    repository: Path,
    tmp_path: Path,
    name: str,
    raw: bytes,
) -> None:
    plan = policy.build_plan(repository)
    bundle = make_bundle(tmp_path, plan)
    (bundle / "_internal" / name).write_bytes(raw)
    with pytest.raises(policy.ResourcePolicyError, match="Prohibited database/key content"):
        policy.verify_bundle(bundle, plan)


def test_bundle_root_symlink_is_rejected(repository: Path, tmp_path: Path) -> None:
    plan = policy.build_plan(repository)
    bundle = make_bundle(tmp_path, plan)
    alias = tmp_path / "bundle alias"
    alias.symlink_to(bundle, target_is_directory=True)
    with pytest.raises(policy.ResourcePolicyError, match="Symlinked bundle root"):
        policy.verify_bundle(alias, plan)


@dataclass
class FakeAnalysis:
    datas: list[policy.TocEntry]
    pure: list[policy.TocEntry]
    binaries: list[policy.TocEntry]
    scripts: list[policy.TocEntry]


@pytest.mark.parametrize("contaminated", (False, True))
def test_generated_spec_uses_real_policy_before_collect_with_fake_build_adapters(
    repository: Path,
    monkeypatch: pytest.MonkeyPatch,
    contaminated: bool,
) -> None:
    plan = policy.build_plan(repository)
    events: list[str] = []
    hooks = ModuleType("PyInstaller.utils.hooks")
    hooks.__dict__["collect_submodules"] = lambda name: ["keyring.backends.null"]
    monkeypatch.setitem(sys.modules, "PyInstaller", ModuleType("PyInstaller"))
    monkeypatch.setitem(sys.modules, "PyInstaller.utils", ModuleType("PyInstaller.utils"))
    monkeypatch.setitem(sys.modules, "PyInstaller.utils.hooks", hooks)
    monkeypatch.setattr(sys, "path", sys.path.copy())

    def analysis(entries: list[str], **kwargs: object) -> FakeAnalysis:
        events.append("analysis")
        assert entries == [str(repository / "backend/server.py")]
        assert kwargs["pathex"] == [str(repository)]
        assert kwargs["datas"] == plan.datas
        assert set(plan.modules) <= set(cast(list[str], kwargs["hiddenimports"]))
        assert "unittest" not in cast(list[str], kwargs["excludes"])
        assert "PIL" not in cast(list[str], kwargs["excludes"])
        data, modules = toc(plan)
        if contaminated:
            data.append(("backend/.env", "/synthetic-hook/secret", "DATA"))
        return FakeAnalysis(data, modules, [], [])

    def pyz(*args: object, **kwargs: object) -> object:
        events.append("pyz")
        return object()

    def exe(*args: object, **kwargs: object) -> object:
        events.append("exe")
        assert kwargs["contents_directory"] == "_internal"
        return object()

    def collect(*args: object, **kwargs: object) -> object:
        events.append("collect")
        return object()

    namespace: dict[str, object] = {
        "Analysis": analysis,
        "PYZ": pyz,
        "EXE": exe,
        "COLLECT": collect,
    }
    spec = policy.render_spec(repository, HELPER.parent)
    if contaminated:
        # The spec imports its helper under its standalone CLI module name.
        with pytest.raises(ValueError, match="Prohibited resource path"):
            exec(compile(spec, "backend.spec", "exec"), namespace)
        assert events == ["analysis"]
    else:
        exec(compile(spec, "backend.spec", "exec"), namespace)
        assert events == ["analysis", "pyz", "exe", "collect"]


def test_spec_windows_paths_are_literal_without_backslash_or_quote_corruption() -> None:
    root = Path("C:\\Users\\Builder's Folder\\Gnosi")
    source = policy.render_spec(root, Path("C:\\Helper Folder"))
    parsed = ast.parse(source)
    strings = [
        node.value
        for node in ast.walk(parsed)
        if isinstance(node, ast.Constant) and isinstance(node.value, str)
    ]
    assert str(root) in strings
    assert str(root / "backend/server.py") in strings


# The real shell workflow runs, but uv/PyInstaller/smoke are fixture executables.
# Only the policy helper executes real logic. No install/download/backend process.
FAKE_INTERPRETER = r"""
import json, os, runpy, shutil, sys
from pathlib import Path
args = sys.argv[1:]
with Path(os.environ['FIXTURE_EVENTS']).open('a') as handle:
    handle.write(json.dumps(['python', args]) + '\n')
if args == ['--version']:
    print('Python 3.11.14')
elif args[:2] == ['-m', 'PyInstaller']:
    mode = os.environ.get('FIXTURE_FAILURE', '')
    if mode == 'pyinstaller': sys.exit(7)
    if mode == 'no-output': sys.exit(0)
    sys.path.insert(0, str(Path(os.environ['FIXTURE_HELPER']).parent))
    import backend_resources
    plan = backend_resources.build_plan(Path(os.environ['FIXTURE_REPOSITORY']))
    bundle = Path.cwd() / 'dist/cervell_backend/_internal'
    for name in plan.resources:
        output = bundle / name
        output.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(plan.repository / name, output)
    if mode == 'contaminated':
        (bundle / 'backend/.env').write_text('synthetic; never read')
    if mode == 'missing':
        (bundle / 'backend/data/model_catalog.json').unlink()
elif args and args[0].endswith('smoke-packaged-backend.py'):
    # Deliberately do not execute the real smoke script or any application.
    pass
else:
    sys.argv = args
    runpy.run_path(args[0], run_name='__main__')
"""
FAKE_UV = r"""
import json, os, shutil
from pathlib import Path
with Path(os.environ['FIXTURE_EVENTS']).open('a') as handle:
    handle.write(json.dumps(['uv', __import__('sys').argv[1:]]) + '\n')
layout = os.environ['FIXTURE_VENV_LAYOUT']
output = Path(os.environ['UV_PROJECT_ENVIRONMENT']) / layout
output.parent.mkdir(parents=True)
shutil.copyfile(os.environ['FIXTURE_INTERPRETER'], output)
output.chmod(0o755)
"""


@pytest.mark.parametrize("layout", ("bin/python", "Scripts/python.exe"))
@pytest.mark.parametrize(
    "failure", ("", "pyinstaller", "no-output", "contaminated", "missing", "source")
)
def test_real_shell_with_simulated_build_commands_and_paths_with_spaces(
    repository: Path,
    tmp_path: Path,
    layout: str,
    failure: str,
) -> None:
    desktop = repository / "desktop"
    (desktop / "scripts").mkdir(parents=True)
    shutil.copyfile(BUILD, desktop / "build-python.sh")
    shutil.copyfile(HELPER, desktop / "scripts/backend_resources.py")
    interpreter = write(
        tmp_path, "fake tools/python with spaces", f"#!{sys.executable}\n" + FAKE_INTERPRETER
    )
    interpreter.chmod(0o755)
    fake_uv = write(tmp_path, "fake tools/uv", f"#!{sys.executable}\n" + FAKE_UV)
    fake_uv.chmod(0o755)
    temp = tmp_path / "temporary environments with spaces"
    temp.mkdir()
    events_path = tmp_path / "build-events.jsonl"
    previous = write(desktop, "dist-python/previous-build-sentinel", "preserve on failure")
    if failure == "source":
        write(repository, "backend/agent/instructions/.env", "do not read")
    env = {
        "PATH": f"{fake_uv.parent}{os.pathsep}/usr/bin{os.pathsep}/bin",
        "TMPDIR": str(temp),
        "GNOSI_PYTHON_CMD": str(interpreter),
        "FIXTURE_INTERPRETER": str(interpreter),
        "FIXTURE_EVENTS": str(events_path),
        "FIXTURE_VENV_LAYOUT": layout,
        "FIXTURE_FAILURE": failure,
        "FIXTURE_HELPER": str(desktop / "scripts/backend_resources.py"),
        "FIXTURE_REPOSITORY": str(repository),
        "PYTHONDONTWRITEBYTECODE": "1",
    }
    result = subprocess.run(
        ["/bin/bash", str(desktop / "build-python.sh")],
        cwd=tmp_path,
        env=env,
        text=True,
        capture_output=True,
        timeout=30,
    )
    events = [json.loads(line) for line in events_path.read_text().splitlines()]
    python_calls = [entry[1] for entry in events if entry[0] == "python"]
    smoke = [args for args in python_calls if args[0].endswith("smoke-packaged-backend.py")]
    assert not list(temp.iterdir()), "unique temporary build environment was not cleaned"
    if failure:
        assert result.returncode != 0, result.stdout + result.stderr
        assert not smoke
        if failure == "source":
            assert not [entry for entry in events if entry[0] == "uv"]
        if failure in {"contaminated", "missing"}:
            assert "Backend resource policy failed" in result.stderr
        assert previous.read_text() == "preserve on failure"
    else:
        assert result.returncode == 0, result.stdout + result.stderr
        assert len(smoke) == 1
        assert not previous.exists()
        spec_calls = [args for args in python_calls if len(args) > 1 and args[1] == "spec"]
        assert len(spec_calls) == 1
        build_calls = [args for args in python_calls if args[:2] == ["-m", "PyInstaller"]]
        assert len(build_calls) == 1
        assert "--noconfirm" in build_calls[0]
        assert "--clean" in build_calls[0]
        assert "--workpath" in build_calls[0]
        verification = [args for args in python_calls if len(args) > 1 and args[1] == "verify"]
        assert verification
        assert python_calls.index(verification[-1]) < python_calls.index(smoke[0])
        policy.verify_bundle(desktop / "dist-python", policy.build_plan(repository))


def test_cli_failure_is_redacted(repository: Path, caplog: pytest.LogCaptureFixture) -> None:
    write(repository, "backend/data/model_catalog.json", '{"password":"fixture-secret-value"}')
    assert policy.main(["check-source", "--repository", str(repository)]) == 1
    assert "fixture-secret-value" not in caplog.text
    assert "model_catalog.json" in caplog.text
