"""Synthetic acceptance ownership, process isolation and restart persistence."""

from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys
import textwrap

import pytest

from scripts.ci.acceptance_backend import OWNER_FILE, SOURCE_ROOT, prepare_runtime


def _environment() -> dict[str, str]:
    """A child must never inherit another test run's data selectors or secrets."""
    return {
        name: value for name, value in os.environ.items()
        if not name.startswith(("GNOSI_", "DIGITAL_BRAIN_", "VAULT_", "HOME_HOST_", "LOCAL_DATA_"))
        and not any(marker in name.upper() for marker in
                    ("TOKEN", "SECRET", "PASSWORD", "CREDENTIAL", "API_KEY", "PRIVATE_KEY", "AUTH"))
    }


def _child(code: str, root: Path, *arguments: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, "-c", textwrap.dedent(code), str(root), *arguments],
        cwd=SOURCE_ROOT, env=_environment(), capture_output=True, text=True, timeout=150,
        check=False,
    )


def test_prepare_runtime_keeps_home_and_removes_provider_configuration(tmp_path: Path) -> None:
    root = tmp_path.resolve()
    environment = {
        "HOME": "/synthetic-home-sentinel", "OPENAI_API_KEY": "must-not-inherit",
        "GNOSI_REQUIRE_AUTH": "0", "GNOSI_DESKTOP_VAULT_DISCOVERY": "1",
        "HTTP_PROXY": "http://proxy.example.org", "OLLAMA_BASE_URL": "http://127.0.0.1:11434",
    }
    runtime = prepare_runtime(root, 38573, root / "state.json", environ=environment)

    assert environment["HOME"] == "/synthetic-home-sentinel"
    assert environment["GNOSI_VALIDATION_ROOT"] == str(root)
    assert environment["GNOSI_REQUIRE_AUTH"] == "1"
    assert environment["GNOSI_MODE"] == "organization"
    assert environment["GNOSI_DESKTOP_VAULT_DISCOVERY"] == "0"
    assert not {"OPENAI_API_KEY", "HTTP_PROXY", "OLLAMA_BASE_URL"} & environment.keys()
    assert runtime.state["owner"]["email"] == "owner@acceptance.example.org"
    assert runtime.state["viewer"]["email"] == "viewer@acceptance.example.org"
    assert runtime.state["owner"]["id"] != runtime.state["viewer"]["id"]
    assert len(runtime.state["page_ids"]) == 2
    assert all(row["content"].strip() for row in runtime.state["rows"])


@pytest.mark.parametrize("selector", [
    "GNOSI_VALIDATION_ROOT", "GNOSI_DATA_DIR", "DIGITAL_BRAIN_VAULT_PATH",
    "VAULT_HOST_PATH", "HOME_HOST_PATH", "GNOSI_VAULTS_ROOT", "GNOSI_LOCAL_DATA", "LOCAL_DATA_DIR",
    "GNOSI_SHARED_ENV_FILE",
])
def test_non_owned_selectors_fail_before_claiming_data(tmp_path: Path, selector: str) -> None:
    root = tmp_path.resolve()
    with pytest.raises(ValueError, match="owned|escape"):
        prepare_runtime(root, 38573, root / "state.json", environ={selector: str(root.parent)})
    assert not (root / OWNER_FILE).exists()


def test_existing_data_and_storage_symlinks_cannot_be_claimed(tmp_path: Path) -> None:
    root = tmp_path.resolve() / "runtime"
    (root / "vault").mkdir(parents=True)
    note = root / "vault" / "existing.md"
    note.write_text("preserve this unowned data", encoding="utf-8")
    with pytest.raises(ValueError, match="pre-existing application data"):
        prepare_runtime(root, 38573, root / "state.json", environ={})
    assert note.read_text(encoding="utf-8") == "preserve this unowned data"
    assert not (root / OWNER_FILE).exists()
    note.unlink()
    (root / "host").symlink_to(tmp_path.parent, target_is_directory=True)
    with pytest.raises(ValueError, match="disposable root"):
        prepare_runtime(root, 38573, root / "state.json", environ={})


def test_restart_keeps_secret_ids_credentials_and_added_artifacts(tmp_path: Path) -> None:
    root = tmp_path.resolve()
    first_environment = {"HOME": "/home-sentinel"}
    first = prepare_runtime(root, 38573, root / "state.json", environ=first_environment)
    (root / "state.json").write_text(json.dumps(first.state), encoding="utf-8")
    extra = root / "vault" / "edited-synthetic-note.md"
    extra.write_text("an edit that a restart must preserve", encoding="utf-8")
    for name in ("browser-auth.json", "expected-content.json"):
        (root / name).write_text("{}", encoding="utf-8")
    receipt = (root / OWNER_FILE).read_bytes()
    second_environment = {"HOME": "/home-sentinel"}

    second = prepare_runtime(root, 38573, root / "state.json", environ=second_environment)

    assert not second.first_boot
    assert second.state == first.state
    assert (root / OWNER_FILE).read_bytes() == receipt
    assert second_environment["GNOSI_JWT_SECRET"] == first_environment["GNOSI_JWT_SECRET"]
    assert extra.read_text(encoding="utf-8") == "an edit that a restart must preserve"
    assert second_environment["HOME"] == "/home-sentinel"


def test_incomplete_seed_is_never_silently_retried(tmp_path: Path) -> None:
    root = tmp_path.resolve()
    prepare_runtime(root, 38573, root / "state.json", environ={})
    with pytest.raises(ValueError, match="incomplete fixture"):
        prepare_runtime(root, 38573, root / "state.json", environ={})


def test_process_guard_refuses_external_sockets_files_and_processes(tmp_path: Path) -> None:
    result = _child("""
        from pathlib import Path
        import json
        import socket
        import sqlite3
        import subprocess
        import sys
        from scripts.ci.acceptance_backend import install_process_guard, prepare_runtime

        root = Path(sys.argv[1])
        runtime = prepare_runtime(root, 38573, root / "state.json", frontend_port=38574)
        install_process_guard(runtime)
        denied = []
        operations = {
            "external": lambda: socket.socket().connect(("198.51.100.7", 443)),
            "local-provider": lambda: socket.socket().connect(("127.0.0.1", 11434)),
            "dns": lambda: socket.getaddrinfo("provider.example.org", 443),
            "write": lambda: (root.parent / "unowned.txt").write_text("forbidden"),
            "database": lambda: sqlite3.connect(str(root.parent / "unowned.sqlite")),
            "database-uri": lambda: sqlite3.connect((root.parent / "unowned.sqlite").as_uri() + "?mode=ro", uri=True),
            "environment": lambda: (root / ".env").read_text(),
            "process": lambda: subprocess.run([sys.executable, "-c", "pass"]),
            "bind": lambda: socket.socket().bind(("0.0.0.0", 38573)),
        }
        for name, operation in operations.items():
            try:
                operation()
            except PermissionError:
                denied.append(name)
            else:
                raise AssertionError(name + " was not blocked")
        # Inspect allowed destinations without contacting an unrelated listener.
        sys.audit("socket.connect", None, ("127.0.0.1", 38573))
        sys.audit("socket.connect", None, ("127.0.0.1", 38574))
        owned_database = root / "owned.sqlite"
        sqlite3.connect(owned_database).close()
        sqlite3.connect(owned_database.as_uri() + "?mode=ro", uri=True).close()
        (root / "guard-result.json").write_text(json.dumps(denied))
    """, tmp_path.resolve())

    assert result.returncode == 0, result.stderr
    assert json.loads((tmp_path / "guard-result.json").read_text()) == [
        "external", "local-provider", "dns", "write", "database", "database-uri", "environment", "process", "bind",
    ]
    assert not (tmp_path.parent / "unowned.txt").exists()
    assert not (tmp_path.parent / "unowned.sqlite").exists()


_PERSISTENCE_PROBE = """
    import asyncio
    import json
    from pathlib import Path
    import sys
    from scripts.ci.acceptance_backend import create_application, install_process_guard, prepare_runtime

    root = Path(sys.argv[1])
    phase = sys.argv[2]
    runtime = prepare_runtime(root, 38573, root / "fixture-state.json", frontend_port=38574)
    install_process_guard(runtime)
    app = create_application(runtime)
    import httpx

    async def run():
        async with app.router.lifespan_context(app):
            state = json.loads(runtime.state_path.read_text())
            transport = httpx.ASGITransport(app=app)
            headers = {"X-Workspace-Id": state["workspace_id"],
                       "X-Vault-Id": state["vaults"]["primary"]["id"]}
            async with httpx.AsyncClient(transport=transport, base_url=state["backend_url"],
                                         headers=headers) as client:
                denied = await client.get("/api/vault/tables")
                assert denied.status_code == 401, denied.text
                login = await client.post("/api/auth/login", json={
                    "email": state["owner"]["email"], "password": state["owner"]["password"],
                })
                assert login.status_code == 200, login.text
                page_id = state["page_ids"][0]
                page = await client.get("/api/vault/pages/" + page_id)
                assert page.status_code == 200, page.text
                if phase == "mutate":
                    changed = await client.patch("/api/vault/pages/" + page_id, json={
                        "content": "Persist this edited synthetic body across the process restart.",
                        "expected_etag": page.json()["etag"],
                    })
                    assert changed.status_code == 200, changed.text
                    created = await client.post("/api/vault/pages", json={
                        "title": "Created before the restart", "content": "A durable new synthetic page.",
                        "metadata": {"table_id": state["table_id"]},
                    })
                    assert created.status_code == 200, created.text
                    expected = {"id": page_id, "content": changed.json()["content"],
                                "created_id": created.json()["id"],
                                "created_content": created.json()["content"]}
                    (root / "expected-content.json").write_text(json.dumps(expected))
                expected = json.loads((root / "expected-content.json").read_text())
                persisted = await client.get("/api/vault/pages/" + expected["id"])
                assert persisted.status_code == 200, persisted.text
                assert persisted.json()["content"].strip() == expected["content"].strip()
                created = await client.get("/api/vault/pages/" + expected["created_id"])
                assert created.status_code == 200, created.text
                assert created.json()["content"].strip() == expected["created_content"].strip()
                client.headers["X-Vault-Id"] = state["vaults"]["secondary"]["id"]
                absent = await client.get("/api/vault/pages/" + expected["id"])
                assert absent.status_code == 404, absent.text
                secondary = await client.get("/api/vault/pages/" + state["secondary_page"]["id"])
                assert secondary.status_code == 200, secondary.text
                client.headers["X-Vault-Id"] = state["vaults"]["primary"]["id"]
                login = await client.post("/api/auth/login", json={
                    "email": state["viewer"]["email"], "password": state["viewer"]["password"],
                })
                assert login.status_code == 200, login.text
                refused = await client.patch("/api/vault/pages/" + expected["id"],
                                             json={"content": "Viewer must not write"})
                assert refused.status_code == 403, refused.text
                readable = await client.get("/api/vault/pages/" + expected["id"])
                assert readable.status_code == 200, readable.text
                assert readable.json()["content"].strip() == expected["content"].strip()
            assert state["source_root"] == str(Path.cwd().resolve())
            assert all(str(Path.cwd().resolve() / "backend") in path
                       for path in state["source_files"].values())

    asyncio.run(run())
"""


def test_production_auth_vault_isolation_and_fixture_survive_process_restart(tmp_path: Path) -> None:
    """Two fresh interpreters use actual routes, cookies, DBs, files and lifespans."""
    root = tmp_path.resolve()
    first = _child(_PERSISTENCE_PROBE, root, "mutate")
    assert first.returncode == 0, first.stdout + first.stderr
    initial_state = json.loads((root / "fixture-state.json").read_text())
    initial_receipt = (root / OWNER_FILE).read_bytes()
    expected_content = (root / "expected-content.json").read_bytes()

    second = _child(_PERSISTENCE_PROBE, root, "verify")

    assert second.returncode == 0, second.stdout + second.stderr
    assert json.loads((root / "fixture-state.json").read_text()) == initial_state
    assert (root / OWNER_FILE).read_bytes() == initial_receipt
    assert (root / "expected-content.json").read_bytes() == expected_content
