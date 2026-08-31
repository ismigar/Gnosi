"""Match existing Drupal nodes to unsynchronized Vault rows by title."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass

from fastapi import BackgroundTasks, HTTPException

from backend.domains.vault.drupal.core import Metadata
from backend.domains.vault.registry.records import RecordReader
from backend.domains.vault.schemas.pages import PageInfo, PagePatchRequest
from backend.utils.open_values import item_value


Result = dict[str, object]


@dataclass(frozen=True)
class DrupalMatchingDependencies:
    sync_error: type[Exception]
    table_by_id: Callable[[str], Metadata | None]
    pages_for_table: Callable[[str], list[PageInfo]]
    find_nodes_by_title: Callable[[str, str], Awaitable[Sequence[RecordReader]]]
    identity_metadata: Callable[[Metadata, object, object, object], Metadata]
    patch_page: Callable[
        [str, PagePatchRequest, BackgroundTasks],
        Awaitable[object],
    ]


def _validated_context(
    payload: dict[str, object],
    dependencies: DrupalMatchingDependencies,
) -> tuple[str, Metadata, str, bool, set[str] | None]:
    table_id = str(payload.get("table_id") or "").strip()
    if not table_id:
        raise HTTPException(status_code=400, detail="table_id is required")
    table = dependencies.table_by_id(table_id)
    if not table:
        raise HTTPException(status_code=404, detail="Table not found")
    bundle = str(payload.get("bundle") or table.get("drupal_bundle") or "").strip()
    if not bundle:
        raise HTTPException(
            status_code=400,
            detail=("Drupal bundle not configured (pass `bundle` or enable sync)"),
        )
    dry_run = bool(payload.get("dry_run", True))
    raw_ids = payload.get("item_ids")
    wanted = (
        {str(item_id) for item_id in raw_ids} if isinstance(raw_ids, list) and raw_ids else None
    )
    return table_id, table, bundle, dry_run, wanted


async def match_drupal_rows(
    background_tasks: BackgroundTasks,
    payload: dict[str, object],
    dependencies: DrupalMatchingDependencies,
) -> Result:
    """Match exact titles and optionally persist Drupal identity metadata."""
    table_id, table, bundle, dry_run, wanted = _validated_context(
        payload,
        dependencies,
    )
    rows = await asyncio.to_thread(dependencies.pages_for_table, table_id)
    matched: list[Result] = []
    unmatched: list[Result] = []
    ambiguous: list[Result] = []
    for page in rows:
        if wanted is not None and page.id not in wanted:
            continue
        metadata = page.metadata or {}
        if metadata.get("translation_lang") or str(metadata.get("drupal_uuid") or "").strip():
            continue
        title = str(page.title or metadata.get("title") or "").strip()
        if not title:
            continue
        try:
            found = await dependencies.find_nodes_by_title(bundle, title)
        except dependencies.sync_error as error:
            unmatched.append({"row_id": page.id, "title": title, "reason": str(error)})
            continue
        if len(found) == 1:
            match = found[0]
            entry: Result = {
                "row_id": page.id,
                "title": title,
                "nid": item_value(match, "nid"),
                "url": item_value(match, "url"),
                "uuid": item_value(match, "uuid"),
            }
            if not dry_run:
                try:
                    identity = dependencies.identity_metadata(
                        table,
                        item_value(match, "uuid"),
                        item_value(match, "nid"),
                        item_value(match, "url"),
                    )
                    await dependencies.patch_page(
                        page.id,
                        PagePatchRequest.model_validate({"metadata": identity}),
                        background_tasks,
                    )
                    entry["applied"] = True
                except Exception as error:
                    entry["applied"] = False
                    entry["error"] = str(error)
            matched.append(entry)
        elif not found:
            unmatched.append({"row_id": page.id, "title": title})
        else:
            ambiguous.append(
                {
                    "row_id": page.id,
                    "title": title,
                    "nids": [item_value(match, "nid") for match in found],
                }
            )
    return {
        "status": "ok",
        "dry_run": dry_run,
        "bundle": bundle,
        "counts": {
            "matched": len(matched),
            "unmatched": len(unmatched),
            "ambiguous": len(ambiguous),
        },
        "matched": matched,
        "unmatched": unmatched,
        "ambiguous": ambiguous,
    }


__all__ = ["DrupalMatchingDependencies", "match_drupal_rows"]
