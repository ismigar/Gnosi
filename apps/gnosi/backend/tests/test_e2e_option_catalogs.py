"""Integració in-process del cicle complet de catàlegs d'opcions i action_rules.

Cobreix la directiva `vault_option_catalogs_action_rules.md` de cap a cap:
seed-on-enable a l'upsert de taula, opció per defecte en crear registres,
salvaguarda 409 («no es pot traduir un esborrany»), efectes d'Estat en
traduir (original → «Traduït», filla → «Esborrany»), retorn a «Esborrany» en
quedar obsoleta, i renombrar/eliminar opcions amb reescriptura de files.

S'executa DINS del contenidor amb un vault de PROVA aïllat (mai el real) i
SENSE lifespan (TestClient sense context manager → ni scheduler ni MCP):

    docker exec -w /tmp/wt \\
        -e PYTHONPATH=/tmp/wt:/app \\
        -e GNOSI_OPTCAT_E2E=1 \\
        -e DIGITAL_BRAIN_VAULT_PATH=/tmp/testvault \\
        -e GNOSI_LOCAL_DATA=/tmp/testdata \\
        gnosi_backend python -m pytest backend/tests/test_e2e_option_catalogs.py -v
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import shutil
from pathlib import Path

import pytest

pytestmark = pytest.mark.skipif(
    os.environ.get("GNOSI_OPTCAT_E2E") != "1"
    or not os.environ.get("DIGITAL_BRAIN_VAULT_PATH", "").startswith("/tmp/"),
    reason="E2E aïllat: requereix GNOSI_OPTCAT_E2E=1 i un vault de prova a /tmp",
)

VAULT = Path(os.environ.get("DIGITAL_BRAIN_VAULT_PATH", "/tmp/testvault"))

_FM_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n", re.DOTALL)


def read_md(page_id: str) -> dict:
    """Frontmatter del .md d'una pàgina del vault de prova, cercat per id."""
    import yaml

    for md_file in VAULT.rglob("*.md"):
        raw = md_file.read_text(encoding="utf-8")
        match = _FM_RE.match(raw)
        if not match:
            continue
        data = yaml.safe_load(match.group(1)) or {}
        if str(data.get("id")) == page_id:
            return data
    raise AssertionError(f"cap .md amb id {page_id} al vault de prova")


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

    # SENSE context manager: no es dispara el lifespan (scheduler/MCP).
    c = TestClient(app)
    c.headers.update({"X-User-ID": "ismael-legacy"})
    return c


@pytest.fixture(scope="module")
def table(client):
    """Taula traduïble amb camp Estat (select) — l'upsert ha de fer els seeds."""
    payload = {
        "id": "tbl-optcat-e2e",
        "name": "ArticlesOptCatE2E",
        "folder": "ArticlesOptCatE2E",
        "database_id": "db1",
        "translation_enabled": True,
        "properties": [
            {"id": "fld_title00", "name": "Títol", "type": "title", "translatable": True},
            {"id": "fld_body000", "name": "Resum", "type": "text", "translatable": True},
            {"id": "fld_estat00", "name": "Estat", "type": "select",
             "config": {"default_option": "Esborrany"}},
            {"id": "fld_idiom00", "name": "Idioma", "type": "select"},
            {"id": "fld_tags000", "name": "Tags", "type": "multi_select",
             "config": {"options": ["Ètica", "Política"]}},
        ],
    }
    r = client.post("/api/vault/tables", json=payload)
    assert r.status_code == 200, r.text
    return r.json()


def _prop(table_obj, name):
    return next(p for p in table_obj["properties"] if p["name"] == name)


def _row(client, table, **metadata):
    body = {
        "title": metadata.pop("title", "Fila de prova"),
        "content": metadata.pop("content", ""),
        "metadata": {"database_table_id": table["id"], **metadata},
    }
    r = client.post("/api/vault/pages", json=body)
    assert r.status_code == 200, r.text
    return r.json()["id"]


# --- Seeds a l'upsert ---------------------------------------------------------

def test_upsert_seeds_status_options_and_rules(table):
    estat = _prop(table, "Estat")
    names = [o["name"] for o in estat["config"]["options"]]
    # Base + traducció (la taula és traduïble); tot en format ric.
    assert names == ["Esborrany", "Revisat", "Traduït"]
    assert all(o.get("color") for o in estat["config"]["options"])
    assert estat["config"]["role"] == "status"
    assert _prop(table, "Idioma")["config"]["role"] == "language"
    assert _prop(table, "Tags")["config"]["role"] == "tags"
    # Bloc d'action_rules seedejat per a la funcionalitat activa.
    assert "translate_row" in table.get("action_rules", {})
    rule = table["action_rules"]["translate_row"]
    assert rule["requires"][0]["not_in"] == ["Esborrany"]


# --- Opció per defecte en crear -------------------------------------------------

def test_create_page_applies_default_option(client, table):
    page_id = _row(client, table, title="Sense estat explícit")
    md = read_md(page_id)
    estat_val = md.get("Estat") or md.get("fld_estat00")
    assert estat_val == "Esborrany"


# --- Salvaguarda: no es pot traduir un esborrany --------------------------------

def test_translate_draft_blocked_with_409(client, table):
    page_id = _row(client, table, title="Esborrany intocable", Estat="Esborrany")
    r = client.post(
        "/api/vault/skills/translate-row",
        json={"item_id": page_id, "target_languages": ["en"]},
    )
    assert r.status_code == 409, r.text
    assert "esborrany" in r.json()["detail"].lower()


# --- Efectes de traduir: original «Traduït», filla «Esborrany» ------------------

def test_translate_effects_on_source_and_child(client, table):
    from fastapi import BackgroundTasks
    from backend.api import vault_routes as vr

    page_id = _row(
        client, table,
        title="Article revisat", Resum="Un resum en català.",
        Estat="Revisat", Idioma="CA",
    )

    def fake_translate(text, source, lang, deepl_api_key=None):
        return f"[{lang}] {text}", "stub"

    bt = BackgroundTasks()
    result = asyncio.run(vr._do_translate_row(
        page_id, ["en"],
        translate_fn=fake_translate,
        detect_fn=lambda text: "ca",
        deepl_api_key="",
        background_tasks=bt,
    ))
    assert len(result["created"]) == 1, result
    child_id = result["created"][0]["id"]

    child_md = read_md(child_id)
    assert child_md.get("translation_lang") == "en"
    child_estat = child_md.get("Estat") or child_md.get("fld_estat00")
    assert child_estat == "Esborrany"

    source_md = read_md(page_id)
    source_estat = source_md.get("Estat") or source_md.get("fld_estat00")
    assert source_estat == "Traduït"

    # Obsolescència: editar contingut traduïble de l'original torna la filla
    # a «Esborrany» (regla on_stale) a més de marcar-la stale. La revisem
    # primer perquè el canvi sigui observable.
    r = client.patch(f"/api/vault/pages/{child_id}", json={"metadata": {"Estat": "Revisat"}})
    assert r.status_code == 200, r.text
    r = client.patch(
        f"/api/vault/pages/{page_id}",
        json={"metadata": {"Resum": "Un resum en català, ara canviat."}},
    )
    assert r.status_code == 200, r.text
    child_md = read_md(child_id)
    assert child_md.get("translation_stale") is True
    child_estat = child_md.get("Estat") or child_md.get("fld_estat00")
    assert child_estat == "Esborrany"


# --- Renombrar / eliminar opcions amb reescriptura de files ---------------------

def test_option_usage_rename_and_remove(client, table):
    tid = table["id"]
    a = _row(client, table, title="Amb tags 1", Tags=["Ètica", "Política"])
    b = _row(client, table, title="Amb tags 2", Tags=["Ètica"])

    r = client.get(f"/api/vault/tables/{tid}/options/usage", params={"field_id": "fld_tags000"})
    assert r.status_code == 200, r.text
    counts = r.json()["counts"]
    assert counts.get("Ètica") == 2 and counts.get("Política") == 1

    # Renombrar: catàleg + files reescrites per nom.
    r = client.post(
        f"/api/vault/tables/{tid}/options/rename",
        json={"field_id": "fld_tags000", "old": "Ètica", "new": "Filosofia moral"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["files_changed"] == 2
    md_a = read_md(a)
    tags_a = md_a.get("Tags") or md_a.get("fld_tags000")
    assert "Filosofia moral" in tags_a and "Ètica" not in tags_a

    # No hi ha GET per taula individual: validem el catàleg via el registry.
    r = client.get("/api/vault/registry")
    reg_table = next(t for t in r.json()["tables"] if t["id"] == tid)
    tag_names = [o["name"] for o in _prop(reg_table, "Tags")["config"]["options"]]
    assert "Filosofia moral" in tag_names and "Ètica" not in tag_names

    # Eliminar amb reassignació.
    r = client.post(
        f"/api/vault/tables/{tid}/options/remove",
        json={"field_id": "fld_tags000", "value": "Política", "reassign_to": "Filosofia moral"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["files_changed"] == 1
    md_a = read_md(a)
    tags_a = md_a.get("Tags") or md_a.get("fld_tags000")
    assert tags_a == ["Filosofia moral"]
    md_b = read_md(b)
    tags_b = md_b.get("Tags") or md_b.get("fld_tags000")
    assert tags_b == ["Filosofia moral"]


# --- Catàlegs compartits ---------------------------------------------------------

def test_shared_catalogs_roundtrip(client, table):
    r = client.put(
        "/api/vault/option-catalogs/tags-prova",
        json={"options": ["Alfa", {"name": "Beta", "color": "red"}]},
    )
    assert r.status_code == 200, r.text
    r = client.get("/api/vault/option-catalogs")
    cats = r.json()["catalogs"]
    assert [o["name"] for o in cats["tags-prova"]] == ["Alfa", "Beta"]
    assert cats["tags-prova"][1]["color"] == "red"

    # Enllaçar un camp al catàleg: les opcions locals desapareixen del camp.
    payload = dict(table)
    for p in payload["properties"]:
        if p["name"] == "Tags":
            p.setdefault("config", {})["catalog_ref"] = "tags-prova"
    r = client.post("/api/vault/tables", json=payload)
    assert r.status_code == 200, r.text
    tags_cfg = _prop(r.json(), "Tags")["config"]
    assert tags_cfg.get("catalog_ref") == "tags-prova"
    assert "options" not in tags_cfg

    # Amb referències actives, el DELETE del catàleg es refusa amb 409.
    r = client.delete("/api/vault/option-catalogs/tags-prova")
    assert r.status_code == 409
