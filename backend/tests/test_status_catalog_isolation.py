"""Status edits must only reach fields using the selected catalog."""

import asyncio
from contextlib import nullcontext
from copy import deepcopy
from unittest.mock import AsyncMock, Mock
from types import SimpleNamespace

import pytest

from backend.domains.vault.tables import options
from backend.services import option_catalogs as catalogs


@pytest.mark.parametrize("operation", ["rename", "remove"])
@pytest.mark.parametrize("table_id", ["local-a", "global-a"])
def test_status_mutations_rewrite_only_the_selected_catalog(monkeypatch, operation, table_id):
    def table(identifier, shared=False):
        return {"id": identifier, "properties": [{
            "id": "field", "name": "Status", "type": "status",
            "config": {
                "default_option": "Open",
                **({"catalog_ref": "status"} if shared else {"options": ["Open", "Done"]}),
            },
        }]}

    registry = {
        "tables": [table("local-a"), table("local-b"), table("global-a", True), table("global-b", True)],
        "option_catalogs": {"status": ["Open", "Done"]},
    }
    before = deepcopy(registry)
    dependencies = options.OptionDependencies(
        load_registry=lambda: registry,
        save_registry=Mock(),
        registry_mutation=nullcontext,
        pages_for_table=Mock(return_value=[]),
        find_page=Mock(),
        materialize=AsyncMock(),
        parse_frontmatter=Mock(),
        save_page=Mock(),
        refresh_page_cache=Mock(),
        invalidate_page_responses=Mock(),
        read_prop_value=lambda metadata, prop: metadata.get(prop["id"]),
        get_prop_config=catalogs.get_prop_config,
        get_prop_options=catalogs.get_prop_options,
        set_prop_options=catalogs.set_prop_options,
        normalize_options=catalogs.normalize_options,
        auto_color=catalogs.auto_color,
        is_global_status_prop=catalogs.is_global_status_prop,
        status_catalog_ref=catalogs.STATUS_CATALOG_REF,
        logger=Mock(),
    )
    rewrite = AsyncMock(return_value=1)
    monkeypatch.setattr(options, "rewrite_option_in_rows", rewrite)
    if operation == "rename":
        asyncio.run(options.rename_table_option(table_id, {"field_id": "field", "old": "Open", "new": "Review"}, dependencies))
    else:
        asyncio.run(options.remove_table_option(table_id, {"field_id": "field", "value": "Open"}, dependencies))

    expected_tables = ["local-a"] if table_id == "local-a" else ["global-a", "global-b"]
    assert [call.args[0]["id"] for call in rewrite.await_args_list] == expected_tables
    for original, current in zip(before["tables"], registry["tables"], strict=True):
        if current["id"] not in expected_tables:
            assert current == original
    if table_id == "local-a":
        assert registry["option_catalogs"] == before["option_catalogs"]
        effective = catalogs.get_prop_options(registry["tables"][0]["properties"][0])
    else:
        effective = registry["option_catalogs"]["status"]
    assert catalogs.option_names(effective) == (["Review", "Done"] if operation == "rename" else ["Done"])


@pytest.mark.parametrize("shared", [False, True])
def test_usage_counts_only_records_in_the_selected_catalog(shared):
    def table(identifier, linked):
        return {"id": identifier, "properties": [{
            "id": "field", "type": "status",
            "config": {"catalog_ref": "status"} if linked else {"options": ["Open"]},
        }]}

    registry = {"tables": [table("current", shared), table("other-shared", True), table("other-local", False)]}
    rows = {
        "current": [SimpleNamespace(metadata={"field": "Done"})],
        "other-shared": [SimpleNamespace(metadata={"field": "Open"})] * 3,
        "other-local": [SimpleNamespace(metadata={"field": "Open"})] * 5,
    }
    pages_for_table = Mock(side_effect=lambda table_id: rows[table_id])
    dependencies = SimpleNamespace(
        load_registry=lambda: registry,
        pages_for_table=pages_for_table,
        is_global_status_prop=catalogs.is_global_status_prop,
        read_prop_value=lambda metadata, prop: metadata.get(prop["id"]),
    )
    result = asyncio.run(options.table_option_usage("current", "field", dependencies))
    assert result["counts"] == ({"Done": 1, "Open": 3} if shared else {"Done": 1})
    assert [call.args[0] for call in pages_for_table.call_args_list] == (
        ["current", "other-shared"] if shared else ["current"]
    )
