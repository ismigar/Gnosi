"""Apply validated button changes through the canonical page mutation workflow."""

from dataclasses import replace
from pathlib import Path
from collections.abc import Callable
from typing import Any

from fastapi import BackgroundTasks, HTTPException

from backend.domains.vault.pages.patch_service import PatchPageDependencies, patch_page
from backend.domains.vault.registry.state import RegistryData
from backend.domains.vault.registry.records import is_record
from backend.services.button_action_contracts import ButtonAssignment
from backend.domains.vault.schemas.pages import PagePatchRequest
from backend.services.agent_execution_scope import current_scope
from backend.services.button_field_execution import prepare_button_assignments


async def commit_button_mutation(note_id: str, path: Path, original: str, fields: list[dict[str, Any]],
                                  assignments: list[ButtonAssignment], *, guard: Callable[[], None] | None = None,
                                  dependencies: PatchPageDependencies | None = None) -> RegistryData:
    if dependencies is None:
        from backend.domains.vault.pages.preview_routes import _PATCH_PAGE_DEPENDENCIES
        dependencies = _PATCH_PAGE_DEPENDENCIES
    ports = dependencies
    def validate(file_path: Path, _metadata: RegistryData, _body: str, raw: str | None) -> None:
        if file_path.resolve() != path.resolve() or raw != original:
            raise HTTPException(409, "The row changed while preparing the button action")
        scope = current_scope()
        if not file_path.resolve().is_relative_to(Path(scope.vault_path).resolve()):
            raise HTTPException(403, "Button page is outside the selected vault")
        if guard is not None:
            guard()
        prepared, _ = prepare_button_assignments(file_path, original, fields, assignments)
        # Title resolution happens while the source page lock is held. Apply
        # its canonical identifiers to the same request validated above.
        request_metadata = request.metadata
        if request_metadata is None:
            raise HTTPException(422, "Button assignments require page metadata")
        for assignment in assignments:
            name = assignment["field"]
            request_metadata[name] = prepared.get(name, assignment["value"])
        if ports.validate_patch is not None:
            ports.validate_patch(file_path, _metadata, _body, raw)
    changes: dict[str, Any] = {}
    for assignment in assignments:
        name = assignment["field"]
        changes[name] = assignment["value"]
        changes[name + "_manual"] = True
    tasks = BackgroundTasks()
    request = PagePatchRequest(metadata=changes)
    result = await patch_page(note_id, request, tasks, current_scope().user_id,
                              replace(ports, validate_patch=validate))
    # Complete dependent work independently of whether the HTTP response reaches
    # its client. A successful response means the normal mutation tasks finished.
    await tasks()
    metadata = result["metadata"]
    if not is_record(metadata):
        raise HTTPException(500, "Invalid page mutation metadata")
    return metadata
