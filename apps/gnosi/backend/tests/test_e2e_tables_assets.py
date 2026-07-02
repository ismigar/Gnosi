"""E2E tests against a running backend at http://127.0.0.1:5002.

These exercise the create→rename→delete table cycle with the asset folder
side-effects that were failing before the recent fixes:

    - create_table must create both Assets/<TableName>/ (flat) and the
      structured Assets/<DB>/<Table>/ paths.
    - rename_table must move both folders.
    - delete_table must remove both. The flat folder used to leak.

We skip the test if the backend isn't reachable.

Run inside the backend container:
    docker exec gnosi_backend python -m pytest backend/tests/test_e2e_tables_assets.py -v
"""
from __future__ import annotations

import os
from pathlib import Path

import pytest
import requests

BACKEND = os.environ.get("GNOSI_BACKEND_URL", "http://127.0.0.1:5002")
VAULT = Path(os.environ.get("DIGITAL_BRAIN_VAULT_PATH", "/vault"))
ASSETS = VAULT / "Assets"


def _backend_alive() -> bool:
    try:
        r = requests.get(f"{BACKEND}/api/health", timeout=2)
        return r.status_code == 200
    except Exception:
        return False


pytestmark = pytest.mark.skipif(
    not _backend_alive() or not ASSETS.exists(),
    reason="backend not reachable or vault not mounted; E2E skipped",
)


@pytest.fixture
def first_database_id():
    r = requests.get(f"{BACKEND}/api/vault/registry", timeout=5)
    r.raise_for_status()
    dbs = r.json().get("databases", [])
    if not dbs:
        pytest.skip("no databases configured")
    return dbs[0]["id"]


def _delete_table(table_id):
    requests.delete(f"{BACKEND}/api/vault/tables/{table_id}", timeout=5)


def test_create_table_creates_flat_assets_dir(first_database_id):
    name = "PytestE2EFlatAssets"
    payload = {
        "name": name, "folder": name,
        "database_id": first_database_id,
        "properties": [{"name": "Nom", "type": "title"}],
    }
    r = requests.post(f"{BACKEND}/api/vault/tables", json=payload, timeout=5)
    r.raise_for_status()
    tid = r.json()["id"]
    try:
        # The flat per-table folder must exist
        assert (ASSETS / name).is_dir(), f"flat Assets/{name}/ not created"
    finally:
        _delete_table(tid)


def test_create_table_creates_property_assets_dir(first_database_id):
    name = "PytestE2EPropAssets"
    payload = {
        "name": name, "folder": name,
        "database_id": first_database_id,
        "properties": [
            {"name": "Nom", "type": "title"},
            {"name": "Foto", "type": "files"},
        ],
    }
    r = requests.post(f"{BACKEND}/api/vault/tables", json=payload, timeout=5)
    r.raise_for_status()
    tid = r.json()["id"]
    try:
        # At least one of the structured paths matching the table name should exist
        matches = list(ASSETS.rglob(f"{name}*"))
        # We expect: Assets/<name>/ (flat) + Assets/<DB>/<name>/<Foto>/
        # We tolerate the DB segment being either the DB name or its id.
        assert any(p.is_dir() for p in matches), \
            f"no asset directory created for property; got {matches}"
    finally:
        _delete_table(tid)


def test_rename_table_moves_flat_assets(first_database_id):
    old, new = "PytestE2ERenameOld", "PytestE2ERenameNew"
    payload = {
        "name": old, "folder": old,
        "database_id": first_database_id,
        "properties": [{"name": "Nom", "type": "title"}],
    }
    r = requests.post(f"{BACKEND}/api/vault/tables", json=payload, timeout=5)
    r.raise_for_status()
    tid = r.json()["id"]
    try:
        requests.put(
            f"{BACKEND}/api/vault/tables/{tid}",
            json={"name": new, "folder": new}, timeout=5,
        ).raise_for_status()
        assert (ASSETS / new).is_dir(), "renamed flat dir missing"
        assert not (ASSETS / old).exists(), "old flat dir still present"
    finally:
        _delete_table(tid)


def test_delete_table_removes_all_asset_dirs(first_database_id):
    name = "PytestE2EDeleteCleanup"
    payload = {
        "name": name, "folder": name,
        "database_id": first_database_id,
        "properties": [{"name": "Nom", "type": "title"}],
    }
    r = requests.post(f"{BACKEND}/api/vault/tables", json=payload, timeout=5)
    r.raise_for_status()
    tid = r.json()["id"]
    requests.delete(f"{BACKEND}/api/vault/tables/{tid}", timeout=5).raise_for_status()
    # Background task may need a moment for the rmtree
    import time
    deadline = time.time() + 5
    while time.time() < deadline and (ASSETS / name).exists():
        time.sleep(0.2)
    assert not (ASSETS / name).exists(), \
        f"flat Assets/{name}/ leaked after delete"
    # Defensive scan: walk only directories that exist (some DB segments
    # might not have any assets folder at all). Tolerates FileNotFoundError
    # because OneDrive directories can come and go.
    leftovers = []
    for d in ASSETS.iterdir() if ASSETS.exists() else []:
        try:
            if not d.is_dir():
                continue
            for entry in d.rglob(f"*{name}*"):
                leftovers.append(entry)
        except (FileNotFoundError, PermissionError):
            continue
    assert leftovers == [], f"leftovers under Assets: {leftovers}"
