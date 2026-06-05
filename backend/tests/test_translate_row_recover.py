"""Tests d'unitat per a `_recover_translations_from_disk` (idempotència de
translate-row sota OneDrive).

Cobreix la xarxa de seguretat que recupera traduccions filles que existeixen
al disc però que l'indexer no ha pogut indexar (fitxers online-only/dataless
→ entry stub sense `translation_*`), evitant que translate-row en creï
duplicats («… (2).md»).

NO cobreix: la materialització real via daemon de warmup (es mockeja).

Run dins el container:
    docker exec gnosi_backend python -m pytest backend/tests/test_translate_row_recover.py -v
"""
from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

import backend.api.vault_routes as vr
from backend.api.vault_routes import _recover_translations_from_disk

ORIGIN = "5c4f6bc1-2c9d-f3c4-e94f-294d3b1da7ba"


def _write_md(path: Path, frontmatter: dict, body: str = "cos de proba") -> None:
    lines = ["---"]
    for key, value in frontmatter.items():
        lines.append(f"{key}: {value}")
    lines.append("---")
    lines.append(body)
    path.write_text("\n".join(lines), encoding="utf-8")


@pytest.fixture
def patched_dir(tmp_path, monkeypatch):
    """Aïlla la funció de l'I/O extern: materialize no-op i índex/cache locals,
    de manera que el test només exerciti la lògica de descobriment/filtre."""
    async def _noop_materialize(p, label=""):
        return None

    monkeypatch.setattr(vr, "_materialize_if_online_only", _noop_materialize)
    monkeypatch.setattr(vr, "_build_page_cache_entry", lambda p, st: {"id": "stub", "metadata": {}})
    monkeypatch.setattr(vr, "_pages_cache_invalidate_all", lambda: None)
    monkeypatch.setattr(vr, "_bump_page_index_version", lambda v: None)
    monkeypatch.setattr(vr, "_page_index_entries", {})
    monkeypatch.setattr(vr, "_page_id_to_path", {})

    import backend.services.context_vars as cv
    monkeypatch.setattr(cv, "get_active_vault_path", lambda: tmp_path)
    return tmp_path


def test_recovers_missing_child_translation(patched_dir):
    """Recupera només la traducció filla de l'idioma que falta; exclou els
    idiomes ja coneguts, els fills d'un altre origin i els fitxers que no són
    traduccions."""
    d = patched_dir
    _write_md(d / "es.md", {"id": "id-es", "translation_origin_id": ORIGIN, "translation_lang": "es"})
    _write_md(d / "fr.md", {"id": "id-fr", "translation_origin_id": ORIGIN, "translation_lang": "fr"})
    _write_md(d / "other.md", {"id": "id-other", "translation_origin_id": "deadbeef", "translation_lang": "es"})
    _write_md(d / "plain.md", {"id": "id-plain", "title": "no es una traduccio"})

    out = asyncio.run(_recover_translations_from_disk(ORIGIN, d, known_langs={"fr"}))

    assert set(out) == {"es"}
    assert out["es"].id == "id-es"


def test_no_recovery_when_all_known(patched_dir):
    """Si l'idioma ja consta com a conegut (al snapshot), no es recupera res."""
    d = patched_dir
    _write_md(d / "es.md", {"id": "id-es", "translation_origin_id": ORIGIN, "translation_lang": "es"})

    out = asyncio.run(_recover_translations_from_disk(ORIGIN, d, known_langs={"es"}))

    assert out == {}


def test_origin_id_form_insensitive(patched_dir):
    """L'origin amb guions al fitxer ha de coincidir amb la consulta sense
    guions (canonicalització d'IDs)."""
    d = patched_dir
    _write_md(d / "es.md", {"id": "id-es", "translation_origin_id": ORIGIN, "translation_lang": "es"})

    out = asyncio.run(_recover_translations_from_disk(ORIGIN.replace("-", ""), d, known_langs=set()))

    assert set(out) == {"es"}
    assert out["es"].id == "id-es"
