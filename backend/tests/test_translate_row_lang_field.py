"""Test d'integració de `_do_translate_row`: el subitem traduït queda marcat amb
el camp "Idioma" de l'idioma destí (abans heretava els camps traduïts però el
camp idioma quedava buit).

Mockeja TOT l'I/O (lectura del registre, registre de taules, escriptura) i passa
funcions de traducció falses — NO toca el Vault ni fa cap crida de xarxa. Cobreix
el que els tests purs de `translation_helpers` no poden: que `_do_translate_row`
injecta de debò el valor al `metadata` que passa a `create_page`/`patch_page`.

Run dins el container (té les deps que arrossega vault_routes):
    docker exec gnosi_backend python -m pytest backend/tests/test_translate_row_lang_field.py -v
"""
from __future__ import annotations

import asyncio

import pytest
from fastapi import BackgroundTasks

import backend.api.vault_routes as vr
from backend.api.vault_routes import _do_translate_row

TABLE_ID = "tbl_articles"
ORIGIN_ID = "11111111-2714-8031-911a-e4191d7d01fd"


def _make_table():
    """Taula 'Articles' simplificada: traducció activada, camp Idioma (select
    sense catàleg → s'autogenera) i dos camps traduïbles (títol + text)."""
    return {
        "id": TABLE_ID,
        "translation_enabled": True,
        "properties": [
            {"name": "Títol", "type": "title", "id": "fld_title", "translatable": True},
            {"name": "Idioma", "type": "select", "id": "fld_lang"},
            {"name": "Descripció", "type": "text", "id": "fld_desc", "translatable": True},
        ],
    }


def _fake_translate(text, src, tgt, deepl_api_key=None):
    return f"{text} [{tgt}]", "fake_provider"


def _fake_detect(text):
    # Mai és l'idioma destí (ca/en) → tot es tradueix; no salta cap camp.
    return "es"


@pytest.fixture
def captured(tmp_path, monkeypatch):
    """Aïlla _do_translate_row de l'I/O i captura els PageSaveRequest creats."""
    origin = tmp_path / "original.md"
    origin.write_text(
        "---\n"
        f"id: {ORIGIN_ID}\n"
        f"table_id: {TABLE_ID}\n"
        "title: Enfadoaccionados en las plazas\n"
        "Idioma: ES\n"
        "Descripció: Texto de prueba en castellano.\n"
        "---\n",  # cos buit a propòsit: no carrega el segmenter → cap crida de xarxa
        encoding="utf-8",
    )
    monkeypatch.setattr(vr, "find_page_path", lambda pid: origin)
    monkeypatch.setattr(vr, "_table_by_id", lambda tid: _make_table() if tid == TABLE_ID else None)

    async def _no_existing(_id):
        return {}

    async def _no_recover(*a, **k):
        return {}

    monkeypatch.setattr(vr, "_get_existing_translations", _no_existing)
    monkeypatch.setattr(vr, "_recover_translations_from_disk", _no_recover)

    created = []

    async def _fake_create_page(request, background_tasks):
        created.append(request)
        return {"id": f"new-{len(created)}"}

    monkeypatch.setattr(vr, "create_page", _fake_create_page)
    return created


def _lang_of(metadata):
    """El camp idioma desat (per id o per nom, segons resolgui _do_translate_row)."""
    return metadata.get("fld_lang") or metadata.get("Idioma")


def test_subitems_get_language_field(captured):
    """Cada subitem traduït porta el camp Idioma amb el codi destí en majúscules."""
    result = asyncio.run(
        _do_translate_row(
            ORIGIN_ID,
            ["ca", "en"],
            translate_fn=_fake_translate,
            detect_fn=_fake_detect,
            deepl_api_key="",
            background_tasks=BackgroundTasks(),
        )
    )
    assert len(result["created"]) == 2
    by_lang = {req.metadata.get("translation_lang"): req.metadata for req in captured}
    assert _lang_of(by_lang["ca"]) == "CA"
    assert _lang_of(by_lang["en"]) == "EN"
    # I no s'ha tocat el codi de control: l'idioma destí també hi és com translation_lang.
    assert by_lang["ca"]["translation_source_lang"] == "es"


def test_source_language_is_skipped(captured):
    """L'idioma origen (ES, del camp Idioma) se salta: no es crea cap subitem ES."""
    result = asyncio.run(
        _do_translate_row(
            ORIGIN_ID,
            ["es", "ca"],
            translate_fn=_fake_translate,
            detect_fn=_fake_detect,
            deepl_api_key="",
            background_tasks=BackgroundTasks(),
        )
    )
    langs_created = {req.metadata.get("translation_lang") for req in captured}
    assert langs_created == {"ca"}
    assert any(s["lang"] == "es" and "source" in s["reason"] for s in result["skipped"])
