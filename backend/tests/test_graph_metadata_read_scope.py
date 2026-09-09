"""Graph batches reuse their resolved vault path without losing managed metadata."""

import json
from types import SimpleNamespace

from backend.domains.graph.nodes import load_page_data
from backend.services import llm_wiki_storage


def test_graph_reuses_config_path_for_every_node_and_reads_current_vault(tmp_path, monkeypatch):
    config_dir = tmp_path / "requested-vault"
    pages = config_dir / "llm_wiki" / "pages"
    pages.mkdir(parents=True)
    (pages / "one.json").write_text(
        json.dumps(
            {
                "metadata": {"llm_wiki_status": "ready", "title": "Managed title"},
            }
        ),
        encoding="utf-8",
    )

    def unexpected_path_lookup(*args):
        raise AssertionError("Graph reloaded configuration for one node")

    monkeypatch.setattr(llm_wiki_storage, "page_state_path", unexpected_path_lookup)

    class Config(SimpleNamespace):
        def get(self, _key, default=None):
            return default

    cfg = Config(paths={"GNOSI_CONFIG": config_dir}, colors={})
    cache = {}
    for node_id in ("one", "two"):
        path = tmp_path / f"{node_id}.md"
        path.write_text(
            f"---\nid: {node_id}\ntitle: Portable title\nllm_wiki_status: legacy\n---\nBody",
            encoding="utf-8",
        )
        data = load_page_data(path, path.name, path.stat().st_mtime, cfg, cache)
        assert data["metadata"]["llm_wiki_status"] == ("ready" if node_id == "one" else "legacy")
        assert data["title"] == ("Managed title" if node_id == "one" else "Portable title")
    assert len(cache) == 2
    assert llm_wiki_storage.merge_page_metadata({}, "", state_directory=pages) == {}
