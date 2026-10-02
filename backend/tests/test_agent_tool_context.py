"""Tool worker boundaries retain request authority without leaking it."""

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace

import pytest

from backend.agent.action_confirmations import confirmation_context, current_confirmation_scope
from backend.domains.agent import tool_runtime
from backend.services.agent_behavior import frozen_resources
from backend.services.agent_execution_models import ExecutionScope
from backend.services.agent_execution_scope import current_scope, execution_scope
from backend.services.context_vars import get_active_vault_path


def test_reused_tool_worker_preserves_each_vault_and_confirmation_scope(monkeypatch, tmp_path):
    request = SimpleNamespace(tool_call={"name": "bulk_update_rows", "id": "call"})

    def inspect(_request):
        return {
            "scope": current_scope().model_dump(),
            "vault": str(get_active_vault_path()),
            "confirmation": current_confirmation_scope(),
            "behavior": frozen_resources.get(),
        }

    with ThreadPoolExecutor(max_workers=1) as worker:
        monkeypatch.setattr(tool_runtime, "_EXECUTOR", worker)
        for user in ("alice", "bob"):
            scope = ExecutionScope(user_id=user, workspace_id="team", role="editor", vault_path=str(tmp_path / user))
            confirmation = {
                "user_id": user, "workspace_id": "team", "role": "editor",
                "vault_scope": user + "-vault", "agent_id": "agent", "session_id": user + "-session",
            }
            behavior = {"snapshot": user}
            token = frozen_resources.set(behavior)
            try:
                with execution_scope(scope), confirmation_context(**confirmation):
                    observed = tool_runtime.execute_bounded(request, inspect)
                assert observed["scope"] == scope.model_dump()
                assert Path(observed["vault"]) == tmp_path / user
                assert observed["confirmation"] == confirmation
                assert observed["behavior"] == behavior
            finally:
                frozen_resources.reset(token)
        # Reusing the same worker after both calls must not retain either grant.
        with pytest.raises(RuntimeError, match="authenticated chat context"):
            tool_runtime.execute_bounded(request, lambda _request: current_confirmation_scope())
        assert worker.submit(frozen_resources.get).result() is None
