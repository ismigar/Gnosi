"""Safety contract for generated-tool dry-run confirmation."""

from backend.agent.generated_tools.dry_run import DryRunManager, dry_run_protect
from backend.agent.generated_tools.validator import RiskLevel


def test_external_write_previews_use_unique_pending_ids() -> None:
    manager = DryRunManager()

    manager.create_preview("notion_create", {"title": "First"}, RiskLevel.EXTERNAL_WRITE)
    manager.create_preview("notion_create", {"title": "Second"}, RiskLevel.EXTERNAL_WRITE)

    pending = manager.list_pending()
    assert len(pending) == 2
    assert {item["arguments"]["title"] for item in pending.values()} == {"First", "Second"}


def test_confirmation_consumes_exact_pending_execution() -> None:
    manager = DryRunManager()
    manager.create_preview("delete_page", {"page_id": "page-1"}, RiskLevel.EXTERNAL_WRITE)
    execution_id = next(iter(manager.list_pending()))

    assert manager.confirm_execution(execution_id) is True
    assert manager.get_pending(execution_id) is None
    assert manager.confirm_execution(execution_id) is False


def test_external_write_decorator_does_not_execute_wrapped_function() -> None:
    calls: list[str] = []

    @dry_run_protect(RiskLevel.EXTERNAL_WRITE)
    def publish(value: str) -> str:
        calls.append(value)
        return "published"

    result = publish("draft")

    assert calls == []
    assert "confirmation required" in result


def test_non_external_write_decorator_executes_normally() -> None:
    @dry_run_protect(RiskLevel.LOCAL_WRITE)
    def save(value: str) -> str:
        return f"saved:{value}"

    assert save("draft") == "saved:draft"
