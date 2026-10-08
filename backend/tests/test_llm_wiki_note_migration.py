"""A disposable vault proves retirement, selective repair, conflict detection and rollback."""

import json
from contextlib import nullcontext
from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace

import pytest

from backend.api import vault_routes
from backend.domains.llm_wiki import migration_files as files
from backend.domains.llm_wiki import note_migration as migration
from backend.domains.llm_wiki.field_retirement import retire_schema
from backend.domains.vault.registry.state import RegistryData


def _fixture(tmp_path: Path) -> tuple[Path, Path]:
    vault = tmp_path / "vault"
    output = tmp_path / "output"
    output.mkdir()
    folder = vault / "BD/Brain"
    folder.mkdir(parents=True)
    (vault / ".gnosi/llm_wiki/pages").mkdir(parents=True)
    props = [
        {"id": "state", "name": "Workflow", "type": "status", "config": {"role": "status"}},
        {
            "id": "idea",
            "name": "Idea",
            "type": "select",
            "config": {
                "plugin_roles": {"llm-wiki": "idea_type"},
                "plugin_option_values": {"concepte": "Concept"},
                "options": ["Entity", "Concept", "Summary", "Synthesis"],
            },
        },
        {
            "id": "verification",
            "name": "Renamed verification",
            "type": "select",
            "aliases": ["Verification status"],
            "config": {"plugin_roles": {"llm-wiki": "verification"}},
        },
        {
            "id": "review",
            "name": "Renamed review",
            "type": "date",
            "config": {"plugin_roles": {"llm-wiki": "last_reviewed"}},
        },
        {"id": "created", "name": "Creation", "type": "created_time"},
        {"id": "modified", "name": "Modified", "type": "last_edited_time"},
    ]
    table = {
        "id": "brain",
        "folder": "Brain",
        "database_id": "db",
        "properties": props,
        "views": [
            {
                "columns": ["idea", "verification", "review"],
                "sorts": [{"propertyId": "review"}],
                "filters": [
                    {"property": "verification", "value": "Verified"},
                    {"property": "state", "value": "Finished"},
                ],
            }
        ],
    }
    config = {
        "brain_table_id": "brain",
        "brain_roles": {
            "idea_type": "idea",
            "verification": "verification",
            "last_reviewed": "review",
        },
        "source_tables": [
            {
                "table_id": "sources",
                "assignment_field_ids": ["state"],
                "dimension_mappings": {"state": {"mode": "fixed", "fixed_value": "Finished"}},
            }
        ],
    }
    (vault / "BD/vault_db_registry.json").write_text(
        json.dumps({"tables": [table], "databases": [{"id": "db", "folder": "BD"}]})
    )
    (vault / ".gnosi/llm_wiki.json").write_text(json.dumps(config))
    for identifier, value, managed in [
        ("concept", "Concept", True),
        ("empty", None, True),
        ("manual", "Synthesis", True),
        ("permanent", "Entity", False),
    ]:
        metadata: RegistryData = {
            "id": identifier,
            "table_id": "brain",
            "title": identifier,
            "Idea": value,
            "Workflow": "Finished",
            "Creation": "2000-01-01T00:00:00+00:00",
            "Renamed verification": "Verified",
            "Last reviewed": "2020-01-01",
            "custom": {"keep": True},
        }
        body = f"<!-- internal -->\nUnchanged body for {identifier}. [[other|Other]]\n[Citation](gnosi-cite:?res=book&segment=s)\n"
        (folder / f"{identifier}.md").write_text(files.markdown(metadata, body))
        if managed:
            state = {
                "version": 1,
                "page_id": identifier,
                "metadata": {
                    "llm_wiki_managed": True,
                    "note_type": "lectura",
                    "llm_wiki_resource_id": "book",
                    "llm_wiki_resource_title": "Book",
                    "llm_wiki_source_table_id": "sources",
                    "llm_wiki_key": identifier,
                    "llm_wiki_stale": identifier == "empty",
                },
            }
            (vault / f".gnosi/llm_wiki/pages/{identifier}.json").write_text(json.dumps(state))
    return vault, output


def _cache() -> dict[str, object]:
    return {
        "results": {
            "concept": {"value": "Summary", "reason": "Condensed argument"},
            "empty": {"value": None, "reason": "Ambiguous function"},
        }
    }


def test_preview_is_read_only_and_distinguishes_manual_classifications(tmp_path: Path) -> None:
    vault, _ = _fixture(tmp_path)
    before = {p: p.read_bytes() for p in vault.rglob("*") if p.is_file()}
    data = migration.inventory(vault)
    assert {n["id"]: n["action"] for n in data["notes"]} == {
        "concept": "classify",
        "empty": "classify",
        "manual": "manual",
    }
    assert before == {p: p.read_bytes() for p in vault.rglob("*") if p.is_file()}


def test_full_migration_preserves_content_manual_values_and_is_idempotent(tmp_path: Path) -> None:
    vault, output = _fixture(tmp_path)
    before = {p: files.frontmatter(p.read_text()) for p in (vault / "BD/Brain").glob("*.md")}
    data = migration.inventory(vault)
    changes, report = migration.build_changes(vault, data, _cache())
    assert report["counts"] == {"classified": 1, "ambiguous": 1, "manual": 1}
    files.apply(vault, output, changes)
    files.apply(vault, output, changes)
    for p, (metadata, body) in before.items():
        after, after_body = files.frontmatter(p.read_text())
        assert after_body == body
        assert after["id"] == metadata["id"] and after["Creation"] == metadata["Creation"]
        assert after["Workflow"] == "Finished" and after["custom"] == metadata["custom"]
        assert "Renamed verification" not in after and "Last reviewed" not in after
    assert files.frontmatter((vault / "BD/Brain/manual.md").read_text())[0]["Idea"] == "Synthesis"
    assert files.frontmatter((vault / "BD/Brain/permanent.md").read_text())[0]["Idea"] == "Entity"
    state = files.read_json(vault / ".gnosi/llm_wiki/pages/empty.json")["metadata"]
    assert (
        state["llm_wiki_stale"] is True and state["llm_wiki_idea_classification"]["value"] is None
    )
    registry = files.read_json(vault / "BD/vault_db_registry.json")
    table = registry["tables"][0]
    assert table["views"] == [
        {"columns": ["idea"], "sorts": [], "filters": [{"property": "state", "value": "Finished"}]}
    ]
    config = files.read_json(vault / ".gnosi/llm_wiki.json")
    assert config["source_tables"][0]["assignment_field_ids"] == ["idea"]
    assert not config["source_tables"][0]["dimension_mappings"]
    second = migration.inventory(vault)
    again, _ = migration.build_changes(vault, second, {})
    assert again == []
    assert not (
        {"verification", "last_reviewed"}
        & {role for role, _, _ in vault_routes._brain_schema("ca")}
    )


def test_concurrent_edit_blocks_all_writes_and_backup_creation(tmp_path: Path) -> None:
    vault, output = _fixture(tmp_path)
    changes, _ = migration.build_changes(vault, migration.inventory(vault), _cache())
    path = vault / "BD/Brain/concept.md"
    path.write_text(path.read_text() + "Concurrent edit\n")
    config_before = (vault / ".gnosi/llm_wiki.json").read_bytes()
    with pytest.raises(ValueError, match="changed after preview"):
        files.apply(vault, output, changes)
    assert (vault / ".gnosi/llm_wiki.json").read_bytes() == config_before
    assert not (output / "vault-before.tar.gz").exists()


def test_verified_rollback_restores_every_original_byte(tmp_path: Path) -> None:
    vault, output = _fixture(tmp_path)
    before = {p: p.read_bytes() for p in vault.rglob("*") if p.is_file()}
    changes, _ = migration.build_changes(vault, migration.inventory(vault), _cache())
    files.apply(vault, output, changes)
    files.rollback(vault, output, changes)
    assert before == {p: p.read_bytes() for p in vault.rglob("*") if p.is_file()}


def test_schema_retirement_rejects_shared_fields_and_preserves_status(tmp_path: Path) -> None:
    vault, _ = _fixture(tmp_path)
    data = migration.inventory(vault)
    table, config = deepcopy(data["table"]), data["config"]
    table["properties"][2]["config"]["plugin_roles"]["another-plugin"] = "required"
    with pytest.raises(ValueError, match="shared"):
        retire_schema(table, config)
    table = deepcopy(data["table"])
    config = {**config, "brain_roles": {"verification": "state"}}
    with pytest.raises(ValueError, match="incompatible|workflow"):
        retire_schema(table, config)


def test_interrupted_apply_resumes_without_losing_the_original_backup(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    vault, output = _fixture(tmp_path)
    changes, _ = migration.build_changes(vault, migration.inventory(vault), _cache())
    write = files.safe_write_text
    calls = 0

    def interrupt(path: Path, text: str) -> None:
        nonlocal calls
        calls += 1
        if calls == 2:
            raise OSError("Simulated interruption")
        write(path, text)

    with monkeypatch.context() as patch:
        patch.setattr(files, "safe_write_text", interrupt)
        with pytest.raises(OSError, match="interruption"):
            files.apply(vault, output, changes)
    backup_hash = files.files_digest(output / "vault-before.tar.gz")
    assert files.apply(vault, output, changes)["complete"] is True
    assert files.files_digest(output / "vault-before.tar.gz") == backup_hash


def test_legacy_sidecar_creation_and_rollback_are_reversible(tmp_path: Path) -> None:
    vault, output = _fixture(tmp_path)
    side = vault / ".gnosi/llm_wiki/pages/concept.json"
    path = vault / "BD/Brain/concept.md"
    meta, body = files.frontmatter(path.read_text())
    meta.update(files.read_json(side)["metadata"])
    path.write_text(files.markdown(meta, body))
    side.unlink()
    original = path.read_bytes()
    changes, _ = migration.build_changes(vault, migration.inventory(vault), _cache())
    files.apply(vault, output, changes)
    assert side.exists()
    files.rollback(vault, output, changes)
    assert not side.exists() and path.read_bytes() == original


@pytest.mark.parametrize(("mode", "value"), [("fixed", "Summary"), ("empty", None)])
def test_repair_honors_explicit_assignment_without_a_model(
    tmp_path: Path, mode: str, value: object
) -> None:
    vault, _ = _fixture(tmp_path)
    config_path = vault / ".gnosi/llm_wiki.json"
    config = files.read_json(config_path)
    config["source_tables"][0]["dimension_mappings"]["idea"] = {"mode": mode, "fixed_value": value}
    config_path.write_text(json.dumps(config))
    data = migration.inventory(vault)
    note = next(n for n in data["notes"] if n["id"] == "concept")
    result = migration._configured_assignment(vault, data, note)
    assert result["value"] == value and result["method"] == mode and result["run_ids"] == []


def test_classification_cache_resumes_per_note_without_resetting_budget(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from backend.services import agent_execution, llm_wiki_storage, reading_budget

    vault, output = _fixture(tmp_path)
    calls = []

    def generate(_operation, prompt, **_options):
        notes = json.loads(prompt)["data"]["notes"]
        calls.append([note["id"] for note in notes])
        return SimpleNamespace(
            run_id="synthetic",
            result=json.dumps(
                {
                    "classifications": [
                        {"id": note["id"], "values": ["Concept"], "reason": "One proposition"}
                        for note in notes
                    ]
                }
            ),
        )

    monkeypatch.setattr(agent_execution, "generate_result_for", generate)
    monkeypatch.setattr(
        llm_wiki_storage, "get_job_status", lambda *_args: {"budget_id": "existing-budget"}
    )
    monkeypatch.setattr(reading_budget, "status", lambda key: {"id": key, "remaining_usd": 1})
    monkeypatch.setattr(reading_budget, "session", lambda _key: nullcontext())
    monkeypatch.setattr(
        reading_budget, "configure", lambda *_args: pytest.fail("Must retain existing budget")
    )
    migration._classify(vault, output, migration.inventory(vault))
    migration._classify(vault, output, migration.inventory(vault))
    assert calls == [["concept", "empty"]]
    path = vault / "BD/Brain/empty.md"
    path.write_text(path.read_text() + "Another substantive claim.\n")
    migration._classify(vault, output, migration.inventory(vault))
    assert calls == [["concept", "empty"], ["empty"]]


def test_migration_preserves_crlf_body_bytes(tmp_path: Path) -> None:
    vault, output = _fixture(tmp_path)
    path = vault / "BD/Brain/concept.md"
    path.write_bytes(path.read_bytes().replace(b"\n", b"\r\n"))
    _meta, body = files.frontmatter(files.read_markdown(path))
    changes, _ = migration.build_changes(vault, migration.inventory(vault), _cache())
    files.apply(vault, output, changes)
    assert files.frontmatter(files.read_markdown(path))[1].encode() == body.encode()
