"""Generated tools and filesystem skills remain distinct catalogs."""

from backend.agent.generated_tools.registry import ToolRegistry


def test_approved_generated_tools_do_not_scan_pipeline_skill_folders(
    monkeypatch,
    tmp_path,
):
    registry = ToolRegistry(tmp_path / "registry.sqlite")
    monkeypatch.setattr(
        "backend.agent.generated_tools.registry.load_params",
        lambda strict_env=False: (_ for _ in ()).throw(
            AssertionError("filesystem skill discovery must not run")
        ),
    )

    assert registry.list_approved() == []
    stats = registry.get_stats()
    assert stats["approved"] == 0
    assert stats["internal_skills"] == 0
