"""In-process E2E: BibTeX import writes CATALOG labels, export reads them back.

Full cycle of the Item Type write-space normalization: a .bib import into a
table whose 'Item Type' select speaks Catalan must persist 'Llibre'/'Tesi'
(not 'book'/'thesis') in the frontmatter, and the BibTeX export must resolve
those labels back to '@book'/'@phdthesis' instead of degrading to '@misc'.

Runs against an isolated TEST vault (never the real one) and WITHOUT lifespan
(TestClient without context manager → neither scheduler nor MCP):

    GNOSI_REFS_E2E=1 DIGITAL_BRAIN_VAULT_PATH=/tmp/testvault-refs \\
    GNOSI_LOCAL_DATA=/tmp/testdata-refs \\
    python -m pytest backend/tests/test_e2e_import_references_item_type.py -v
"""
from __future__ import annotations

import io
import json
import os
import re
import shutil
from pathlib import Path

import pytest

pytestmark = pytest.mark.skipif(
    os.environ.get("GNOSI_REFS_E2E") != "1"
    or not os.environ.get("DIGITAL_BRAIN_VAULT_PATH", "").startswith("/tmp/"),
    reason="Isolated E2E: requires GNOSI_REFS_E2E=1 and a test vault under /tmp",
)

VAULT = Path(os.environ.get("DIGITAL_BRAIN_VAULT_PATH", "/tmp/testvault-refs"))

_FM_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n", re.DOTALL)

BIB = """
@book{marx1867, title = {El Capital}, author = {Marx, Karl}, year = {1867}}
@phdthesis{turing1938, title = {Systems of Logic}, author = {Turing, Alan}, year = {1938}}
@article{turkle2015, title = {Reclaiming Conversation}, author = {Turkle, Sherry},
         journal = {Tech Review}, year = {2015}}
"""


def _frontmatters() -> list[dict]:
    import yaml

    out = []
    for md_file in VAULT.rglob("*.md"):
        match = _FM_RE.match(md_file.read_text(encoding="utf-8"))
        if match:
            out.append(yaml.safe_load(match.group(1)) or {})
    return out


@pytest.fixture(scope="module")
def client():
    shutil.rmtree(VAULT, ignore_errors=True)
    (VAULT / "BD").mkdir(parents=True)
    (VAULT / "BD" / "vault_db_registry.json").write_text(
        json.dumps({
            "databases": [{"id": "db1", "name": "Test DB"}],
            "tables": [],
            "views": [],
        }),
        encoding="utf-8",
    )
    from fastapi.testclient import TestClient
    from backend.server import app

    # WITHOUT a context manager: the lifespan doesn't fire (scheduler/MCP).
    c = TestClient(app)
    c.headers.update({"X-User-ID": "ismael-legacy"})
    return c


@pytest.fixture(scope="module")
def table(client):
    """References-like table: Citation Key column + Catalan Item Type catalog."""
    payload = {
        "id": "tbl-refs-e2e",
        "name": "RecursosRefsE2E",
        "folder": "RecursosRefsE2E",
        "database_id": "db1",
        "properties": [
            {"id": "fld_title00", "name": "Title", "type": "title"},
            {"id": "fld_citkey0", "name": "Citation Key", "type": "text"},
            {"id": "fld_ittype0", "name": "Item Type", "type": "select",
             "config": {"options": ["Llibre", "Tesi", "Article de revista acadèmica"]}},
        ],
    }
    r = client.post("/api/vault/tables", json=payload)
    assert r.status_code == 200, r.text
    return r.json()


def test_import_writes_catalog_labels(client, table):
    r = client.post(
        f"/api/vault/import-references?table_id={table['id']}&fmt=auto",
        files={"file": ("refs.bib", io.BytesIO(BIB.encode("utf-8")), "text/plain")},
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["created"] == 3, data
    by_key = {m.get("Citation Key"): m for m in _frontmatters() if m.get("Citation Key")}
    assert by_key["marx1867"]["Item Type"] == "Llibre"
    assert by_key["turing1938"]["Item Type"] == "Tesi"
    assert by_key["turkle2015"]["Item Type"] == "Article de revista acadèmica"


def test_export_resolves_labels_back_to_bibtex_types(client, table):
    r = client.get(f"/api/vault/export-references?table_id={table['id']}&fmt=bibtex")
    assert r.status_code == 200, r.text
    bib = r.text
    assert "@book{marx1867," in bib
    assert "@phdthesis{turing1938," in bib
    assert "@article{turkle2015," in bib
    assert "@misc" not in bib
