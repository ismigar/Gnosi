"""Test-owned translation ports; no facade, provider, credentials or live vault."""

from __future__ import annotations

import logging
from collections.abc import Iterable
from dataclasses import dataclass, field
from pathlib import Path

from fastapi import BackgroundTasks

from backend.domains.vault.registry.state import RegistryData
from backend.domains.vault.schemas.pages import PagePatchRequest, PageSaveRequest
from backend.domains.vault.translation.page_service import PageTranslationDependencies
from backend.domains.vault.translation.row_service import RowTranslationDependencies
from backend.services import translation_helpers as helpers


@dataclass
class TranslationFixture:
    path: Path
    metadata: RegistryData
    table: RegistryData
    trace: list[object] = field(default_factory=list)
    existing: dict[str, object] = field(default_factory=dict)
    recovered: dict[str, object] = field(default_factory=dict)
    known: dict[str, str] = field(default_factory=dict)
    creates: list[PageSaveRequest] = field(default_factory=list)
    patches: list[tuple[str, PagePatchRequest]] = field(default_factory=list)
    new_id: object = "new-child"

    async def existing_translations(self, origin: str) -> dict[str, object]:
        self.trace.append(("existing", origin))
        return self.existing

    async def recover(self, origin: str, directory: Path, known: Iterable[object]) -> dict[str, object]:
        self.trace.append(("recover", origin, directory, set(known)))
        return self.recovered

    async def materialize(self, path: Path, label: str) -> None:
        self.trace.append(("materialize", path, label))

    async def create(self, request: PageSaveRequest, _tasks: BackgroundTasks) -> RegistryData:
        self.trace.append("create")
        self.creates.append(request)
        return {"id": self.new_id, 7: "extension receipt"}

    async def patch(self, page_id: str, request: PagePatchRequest, _tasks: BackgroundTasks) -> RegistryData:
        self.trace.append(("patch", page_id))
        self.patches.append((page_id, request))
        return {"id": page_id, 7: "extension receipt"}

    def text(self, text: str, source_lang: str, target_lang: str, *, deepl_api_key: str) -> tuple[str, str]:
        self.trace.append(("text", text, source_lang, target_lang, deepl_api_key))
        return f"{text}-{target_lang}", "synthetic"

    def markdown(self, body: str, src: str, tgt: str, /, *, deepl_api_key: str) -> tuple[str, set[str]]:
        self.trace.append(("markdown", body, src, tgt, deepl_api_key))
        return f"{body}-{tgt}", {"synthetic", "noop"}

    def title(self, title: str, src: str, tgt: str, /, *, deepl_api_key: str) -> tuple[str, str]:
        self.trace.append(("title", title, src, tgt, deepl_api_key))
        return f"{title}-{tgt}", "synthetic"


def row_fixture(tmp_path: Path) -> tuple[RowTranslationDependencies, TranslationFixture]:
    path = tmp_path / "source.md"
    path.write_text("synthetic source", encoding="utf-8")
    fixture = TranslationFixture(
        path=path,
        metadata={19: object(), "title": "Original", "Idioma": "ca", "table_id": "table"},
        table={23: object(), "id": "table", "translation_enabled": True,
               "properties": [{"id": "title", "type": "title", "name": "title", "translatable": True},
                              {"id": "language", "name": "Idioma"}]},
    )
    dependencies = RowTranslationDependencies(
        find_page=lambda _page_id: path,
        parse_frontmatter=lambda _text, _path: (fixture.metadata, "Body"),
        table_id=lambda _metadata: "table",
        table_by_id=lambda _table_id: fixture.table,
        check_requires=lambda _table, _action, _metadata: (True, None),
        action_translate="translate_row",
        detect_record_source_lang=helpers.detect_record_source_lang,
        is_composite_image_value=helpers.is_composite_image_value,
        is_image_field_name=helpers.is_image_field_name,
        translate_image_field=helpers.translate_image_field,
        language_field_assignment=helpers.language_field_assignment,
        status_effect=lambda _table, _action, _target: (None, None, False),
        effect_write_key=lambda _metadata, _prop: None,
        persist_status_options=lambda table_id, values: fixture.trace.append(("options", table_id, values)),
        write_metadata_key=lambda _page_id, _path, _key, _value: False,
        existing_translations=fixture.existing_translations,
        recover_translations=fixture.recover,
        materialize=fixture.materialize,
        known_translations=lambda _origin: fixture.known,
        record_translation=lambda origin, language, child: fixture.trace.append(("record", origin, language, child)),
        forget_translation=lambda origin, language: fixture.trace.append(("forget", origin, language)),
        create_page=fixture.create, patch_page=fixture.patch,
        load_markdown_translator=lambda: fixture.markdown,
        logger=logging.getLogger(__name__),
    )
    return dependencies, fixture


def page_fixture(tmp_path: Path) -> tuple[PageTranslationDependencies, TranslationFixture]:
    _row, fixture = row_fixture(tmp_path)
    return PageTranslationDependencies(
        load_translators=lambda: (fixture.markdown, fixture.title, lambda _text: "ca"),
        read_deepl_key=lambda: "synthetic-key",
        find_page=lambda _id: fixture.path,
        parse_frontmatter=lambda _raw, _path: (fixture.metadata, "Body"),
        detect_record_source_lang=helpers.detect_record_source_lang,
        existing_translations=fixture.existing_translations,
        create_page=fixture.create, patch_page=fixture.patch,
        logger=logging.getLogger(__name__),
    ), fixture
