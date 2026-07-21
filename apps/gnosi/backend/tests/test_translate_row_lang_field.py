"""Integration test for `_do_translate_row`: the translated subitem gets marked with
the "Idioma" field set to the target language (previously it inherited the translated fields but the
language field stayed empty).

Mocks ALL the I/O (registry read, table registry, writing) and passes
fake translation functions — does NOT touch the Vault or make any network call. Covers
what the pure `translation_helpers` tests cannot: that `_do_translate_row`
actually injects the value into the `metadata` passed to `create_page`/`patch_page`.

Run inside the container (it has the deps that vault_routes pulls in):
    docker exec gnosi_backend python -m pytest backend/tests/test_translate_row_lang_field.py -v
"""
from __future__ import annotations

import asyncio

import pytest
from fastapi import BackgroundTasks

import backend.api.vault_routes as vr
from backend.api.vault_routes import _do_translate_row
from backend.services import translation_index

TABLE_ID = "tbl_articles"
ORIGIN_ID = "11111111-2714-8031-911a-e4191d7d01fd"


def _make_table():
    """Simplified 'Articles' table: translation enabled, Idioma field (select
    with no catalog → auto-generated) and two translatable fields (title + text)."""
    return {
        "id": TABLE_ID,
        "translation_enabled": True,
        "properties": [
            {"name": "Títol", "type": "title", "id": "fld_title", "translatable": True},
            {"name": "Idioma", "type": "select", "id": "fld_lang"},
            {"name": "Descripció", "type": "text", "id": "fld_desc", "translatable": True},
            {"name": "Imatge", "type": "text", "id": "fld_img", "translatable": True},
        ],
    }


def _fake_translate(text, src, tgt, deepl_api_key=None):
    return f"{text} [{tgt}]", "fake_provider"


def _fake_detect(text):
    # Never the target language (ca/en) → everything gets translated; no field is skipped.
    return "es"


@pytest.fixture
def captured(tmp_path, monkeypatch):
    """Isolates _do_translate_row from I/O and captures the created PageSaveRequest objects."""
    origin = tmp_path / "original.md"
    origin.write_text(
        "---\n"
        f"id: {ORIGIN_ID}\n"
        f"table_id: {TABLE_ID}\n"
        "title: Enfadoaccionados en las plazas\n"
        "Idioma: ES\n"
        "Descripció: Texto de prueba en castellano.\n"
        "Imatge:\n"
        "  src: Articles/prueba.png\n"
        "  alt: Texto alternativo en castellano.\n"
        "---\n",  # body empty on purpose: doesn't load the segmenter → no network call
        encoding="utf-8",
    )
    # Translation index isolated in tmp (never touches the real /app/data).
    monkeypatch.setenv("GNOSI_LOCAL_DATA", str(tmp_path))

    monkeypatch.setattr(vr, "find_page_path", lambda pid: origin)
    monkeypatch.setattr(vr, "_table_by_id", lambda tid: _make_table() if tid == TABLE_ID else None)

    async def _no_existing(_id):
        return {}

    async def _no_recover(*a, **k):
        return {}

    async def _noop_materialize(p, label=""):
        return None

    monkeypatch.setattr(vr, "_get_existing_translations", _no_existing)
    monkeypatch.setattr(vr, "_recover_translations_from_disk", _no_recover)
    monkeypatch.setattr(vr, "_materialize_if_online_only", _noop_materialize)

    created = []

    async def _fake_create_page(request, background_tasks):
        created.append(request)
        return {"id": f"new-{len(created)}"}

    async def _fake_patch_page(page_id, request, background_tasks):
        return {"id": page_id}

    monkeypatch.setattr(vr, "create_page", _fake_create_page)
    monkeypatch.setattr(vr, "patch_page", _fake_patch_page)
    return created


def _lang_of(metadata):
    """The saved language field (by id or by name, depending on how _do_translate_row resolves it)."""
    return metadata.get("fld_lang") or metadata.get("Idioma")


def test_subitems_get_language_field(captured):
    """Each translated subitem carries the Idioma field with the target code in uppercase."""
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
    # And the control code hasn't been touched: the target language is also there as translation_lang.
    assert by_lang["ca"]["translation_source_lang"] == "es"


def test_source_language_is_skipped(captured):
    """The source language (ES, from the Idioma field) is skipped: no ES subitem is created."""
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


def test_explicit_source_translates_title_despite_spurious_detect(captured):
    """Title bug: with a declared origin (Idioma: ES), a short title must be
    translated to CA even if `detect_fn` returns it as 'ca' (the spurious default
    of `detect_source_lang` on text with no cue words). Previously the
    `field_lang == lang` skip left it untranslated (noop)."""

    def detect_always_ca(_text):
        # Mimics the spurious default: returns the TARGET (ca) for any text.
        return "ca"

    result = asyncio.run(
        _do_translate_row(
            ORIGIN_ID,
            ["ca"],
            translate_fn=_fake_translate,
            detect_fn=detect_always_ca,
            deepl_api_key="",
            background_tasks=BackgroundTasks(),
        )
    )
    assert len(result["created"]) == 1
    md = captured[0].metadata
    # The title carries the [ca] marker from _fake_translate → it was translated, not a noop.
    assert md.get("fld_title", "").endswith("[ca]"), md
    assert captured[0].title.endswith("[ca]")


def test_image_field_keeps_src_translates_alt(captured):
    """Translatable composite image field: the subitem keeps the SAME image (src, without
    duplicating the file) and translates the text subfields (alt)."""
    result = asyncio.run(
        _do_translate_row(
            ORIGIN_ID,
            ["ca"],
            translate_fn=_fake_translate,
            detect_fn=_fake_detect,
            deepl_api_key="",
            background_tasks=BackgroundTasks(),
        )
    )
    assert len(result["created"]) == 1
    md = captured[0].metadata
    img = md.get("fld_img") or md.get("Imatge")
    assert isinstance(img, dict), md
    assert img["src"] == "Articles/prueba.png"  # image kept, not duplicated
    assert img["alt"] == "Texto alternativo en castellano. [ca]"  # translated alt


def test_translation_registered_in_local_index(captured):
    """When creating subitems, translate-row registers them in the local index
    (origin → lang → id), a reliable idempotency source outside OneDrive."""
    asyncio.run(
        _do_translate_row(
            ORIGIN_ID,
            ["ca", "en"],
            translate_fn=_fake_translate,
            detect_fn=_fake_detect,
            deepl_api_key="",
            background_tasks=BackgroundTasks(),
        )
    )
    known = translation_index.get_known_translations(ORIGIN_ID)
    assert set(known.keys()) == {"ca", "en"}
    assert all(v for v in known.values())


def test_idempotent_via_local_index_no_duplicate(captured):
    """Re-translating the same language reuses the subitem registered in the local index
    (patch), it doesn't create a new one — even if snapshot and _recover return empty
    (the OneDrive online-only case that used to duplicate). There must be only 1 create."""
    args = dict(
        translate_fn=_fake_translate,
        detect_fn=_fake_detect,
        deepl_api_key="",
        background_tasks=BackgroundTasks(),
    )
    asyncio.run(_do_translate_row(ORIGIN_ID, ["ca"], **args))
    asyncio.run(_do_translate_row(ORIGIN_ID, ["ca"], **args))
    assert len(captured) == 1  # the second translate does a patch via the index, not a create
