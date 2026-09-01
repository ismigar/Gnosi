"""Typed Vault domain extracted from the historical route facade."""

import importlib as _legacy_importlib
from typing import Any as _LegacyAny
from typing import cast as _strict_cast

from fastapi import APIRouter

_legacy: _LegacyAny = _legacy_importlib.import_module("backend.api.vault_routes")
router = _strict_cast(APIRouter, _legacy.router)


@router.get(
    "/drupal/content-types",
    dependencies=[_legacy.Depends(_legacy.require_role("editor"))],
    response_model=None,
)
async def drupal_content_types() -> _LegacyAny:
    """Drupal content type for the table config dropdown."""
    from backend.services import drupal_sync_service as drupal

    try:
        return {"content_types": await drupal.list_content_types()}
    except drupal.DrupalSyncError as exc:
        raise _legacy.HTTPException(status_code=502, detail=f"Drupal: {exc}")


@router.get(
    "/drupal/content-types/{bundle}/fields",
    dependencies=[_legacy.Depends(_legacy.require_role("editor"))],
    response_model=None,
)
async def drupal_content_type_fields(bundle: str) -> _LegacyAny:
    """Fields of a Drupal content type for the mapping editor."""
    from backend.services import drupal_sync_service as drupal

    try:
        return {"bundle": bundle, "fields": await drupal.list_fields(bundle)}
    except drupal.DrupalSyncError as exc:
        raise _legacy.HTTPException(status_code=502, detail=f"Drupal: {exc}")


@router.post(
    "/skills/sync-drupal-row",
    dependencies=[_legacy.Depends(_legacy.require_role("editor"))],
    response_model=None,
)
async def sync_drupal_row(
    background_tasks: _legacy.BackgroundTasks,
    payload: dict[_LegacyAny, _LegacyAny] = _legacy.Body(...),
) -> _LegacyAny:
    """Creates or updates a row's Drupal node (and its translations).

    Body: ``{ "item_id": "<uuid>", "button_action": "sync_drupal" }``.
    Idempotent (anchored by `drupal_uuid`). Writes nid/url to the row's
    columns and the uuid to the hidden metadata.

    """
    item_id = (payload.get("item_id") or "").strip()
    button_action = payload.get("button_action") or "sync_drupal"
    if not item_id:
        raise _legacy.HTTPException(status_code=400, detail="item_id is required")
    if button_action != "sync_drupal":
        raise _legacy.HTTPException(
            status_code=400, detail=f"Unsupported button_action: {button_action}"
        )
    publish = payload.get("publish", True)
    scope = payload.get("scope") or "all"
    if scope not in ("all", "lang_only"):
        scope = "all"
    push_media = bool(payload.get("push_media", True))
    result = await _legacy._do_sync_drupal_row(
        item_id,
        background_tasks=background_tasks,
        publish=bool(publish),
        scope=scope,
        push_media=push_media,
    )
    return {"status": "ok", **result}


@router.post(
    "/skills/sync-drupal-rows",
    dependencies=[_legacy.Depends(_legacy.require_role("editor"))],
    response_model=None,
)
async def sync_drupal_rows(
    background_tasks: _legacy.BackgroundTasks,
    payload: dict[_LegacyAny, _LegacyAny] = _legacy.Body(...),
) -> _LegacyAny:
    """Bulk variant of sync-drupal-row. Each row is independent; per-row errors
    are reported in `errors` instead of aborting the batch."""
    item_ids = payload.get("item_ids") or []
    if not isinstance(item_ids, list) or not item_ids:
        raise _legacy.HTTPException(status_code=400, detail="item_ids must be a non-empty list")
    scope = payload.get("scope") or "all"
    if scope not in ("all", "lang_only"):
        scope = "all"
    publish = bool(payload.get("publish", True))
    push_media = bool(payload.get("push_media", True))
    results: list[_LegacyAny] = []
    errors: list[_LegacyAny] = []
    for iid in item_ids:
        try:
            results.append(
                await _legacy._do_sync_drupal_row(
                    str(iid),
                    background_tasks=background_tasks,
                    publish=publish,
                    scope=scope,
                    push_media=push_media,
                )
            )
        except _legacy.HTTPException as exc:
            errors.append({"item_id": iid, "detail": exc.detail})
        except Exception as exc:
            errors.append({"item_id": iid, "detail": str(exc)})
    return {"status": "ok", "results": results, "errors": errors}


@router.post(
    "/skills/match-drupal-rows",
    dependencies=[_legacy.Depends(_legacy.require_role("editor"))],
    response_model=None,
)
async def match_drupal_rows(
    background_tasks: _legacy.BackgroundTasks,
    payload: dict[_LegacyAny, _LegacyAny] = _legacy.Body(...),
) -> _LegacyAny:
    """Links rows to **existing** Drupal nodes by title, without creating anything.

    Searches each row by exact title; if it finds exactly one, writes
    nid/url/uuid to the row (doesn't touch Drupal). Skips translation subitems and rows
    already linked. With ``dry_run`` (default True) only reports what it would do.

    Body: ``{table_id, bundle?, item_ids?, dry_run?}``.

    """
    return await _legacy.drupal_matching.match_drupal_rows(
        background_tasks, payload, _legacy._drupal_matching_dependencies()
    )


@router.post(
    "/skills/translate-row",
    dependencies=[
        _legacy.Depends(_legacy.require_role("editor")),
        _legacy.Depends(_legacy.require_plugins("translation")),
    ],
    response_model=None,
)
async def translate_row(
    background_tasks: _legacy.BackgroundTasks,
    payload: dict[_LegacyAny, _LegacyAny] = _legacy.Body(...),
) -> _LegacyAny:
    """Translate the translatable fields of a row to one subitem per language.

    Body:
        {
          "item_id": "<uuid of the row>",
          "target_languages": ["en", "es", ...],
          "button_action": "translate_row"  # validated; rejects others
        }

    The row's table must have `translation_enabled: true` and at least one
    property marked with `translatable: true`. For each target language a new
    subitem is created (`parent_id = item_id`), with the translated values
    keyed by the same property `id`/`name` as the parent row. Re-running updates
    the existing per-language subitem in place (idempotent) instead of
    duplicating it.
    """
    item_id = (payload.get("item_id") or "").strip()
    target_languages = payload.get("target_languages") or []
    button_action = payload.get("button_action") or "translate_row"
    if not item_id:
        raise _legacy.HTTPException(status_code=400, detail="item_id is required")
    if not isinstance(target_languages, list) or not target_languages:
        raise _legacy.HTTPException(
            status_code=400, detail="target_languages must be a non-empty list"
        )
    if button_action != "translate_row":
        raise _legacy.HTTPException(
            status_code=400, detail=f"Unsupported button_action: {button_action}"
        )
    translate_fn, detect_fn = _legacy._load_translate_row_skill()
    deepl_api_key = _legacy._read_deepl_key()
    result = await _legacy._do_translate_row(
        item_id,
        target_languages,
        translate_fn=translate_fn,
        detect_fn=detect_fn,
        deepl_api_key=deepl_api_key,
        background_tasks=background_tasks,
    )
    return {"status": "ok", **result}


@router.post(
    "/skills/translate-rows",
    dependencies=[
        _legacy.Depends(_legacy.require_role("editor")),
        _legacy.Depends(_legacy.require_plugins("translation")),
    ],
    response_model=None,
)
async def translate_rows(
    background_tasks: _legacy.BackgroundTasks,
    payload: dict[_LegacyAny, _LegacyAny] = _legacy.Body(...),
) -> _LegacyAny:
    """Bulk variant of translate-row: translate many selected rows at once.

    Body:
        {
          "item_ids": ["<uuid>", ...],
          "target_languages": ["en", "es", ...],
          "button_action": "translate_row"  # validated; rejects others
        }

    Each row is processed independently and idempotently (see `_do_translate_row`).
    A per-row failure (e.g. a selected row whose table isn't translatable) is
    reported in `errors` rather than aborting the whole batch.
    """
    item_ids = payload.get("item_ids") or []
    target_languages = payload.get("target_languages") or []
    button_action = payload.get("button_action") or "translate_row"
    if not isinstance(item_ids, list) or not item_ids:
        raise _legacy.HTTPException(status_code=400, detail="item_ids must be a non-empty list")
    if not isinstance(target_languages, list) or not target_languages:
        raise _legacy.HTTPException(
            status_code=400, detail="target_languages must be a non-empty list"
        )
    if button_action != "translate_row":
        raise _legacy.HTTPException(
            status_code=400, detail=f"Unsupported button_action: {button_action}"
        )
    translate_fn, detect_fn = _legacy._load_translate_row_skill()
    deepl_api_key = _legacy._read_deepl_key()
    results: list[_LegacyAny] = []
    errors: list[_LegacyAny] = []
    seen: set[_LegacyAny] = set()
    for raw_id in item_ids:
        item_id = raw_id.strip() if isinstance(raw_id, str) else ""
        if not item_id or item_id in seen:
            continue
        seen.add(item_id)
        try:
            res = await _legacy._do_translate_row(
                item_id,
                target_languages,
                translate_fn=translate_fn,
                detect_fn=detect_fn,
                deepl_api_key=deepl_api_key,
                background_tasks=background_tasks,
            )
            results.append(res)
        except _legacy.HTTPException as exc:
            errors.append({"item_id": item_id, "detail": exc.detail})
        except Exception as exc:
            _legacy.log.error(f"translate_rows: unexpected error for {item_id}: {exc}")
            errors.append({"item_id": item_id, "detail": str(exc)})
    return {"status": "ok", "count": len(results), "results": results, "errors": errors}


@router.post(
    "/skills/generate-button-action",
    dependencies=[_legacy.Depends(_legacy.require_role("editor"))],
    response_model=None,
)
async def generate_button_action(
    payload: dict[_LegacyAny, _LegacyAny] = _legacy.Body(...),
) -> _LegacyAny:
    """Generates structured button action configuration using LLM based on user prompt."""
    user_prompt = (payload.get("prompt") or "").strip()
    fields = payload.get("fields") or []
    if not user_prompt:
        raise _legacy.HTTPException(status_code=400, detail="Prompt is required")
    import json
    import re

    from backend.agent.factory import generate_text

    field_names = [
        str(field["name"]) for field in fields if isinstance(field, dict) and field.get("name")
    ]
    system_instruction = f"""You are an AI assistant helping configure table button actions in a database application.\nAvailable table fields: {(", ".join(field_names) if field_names else "Title")}\n\nGiven the user's natural language request, output ONLY a valid JSON object (no markdown wrapping) with these keys:\n{{\n  "button_label": "<Short button label max 20 characters>",\n  "button_action": "set_fields" | "ai_prompt" | "run_skill",\n  "button_config": {{\n    "assignments": [\n       {{ "field": "<field_name>", "value": "<literal or formula like today()>" }}\n    ],\n    "prompt": "<prompt text for ai_prompt>",\n    "target_field": "<target field_name for ai_prompt>",\n    "skill_id": "<skill id for run_skill>"\n  }}\n}}\n"""
    try:
        raw_resp, _ = await _legacy.asyncio.to_thread(
            generate_text, system_instruction, user_prompt
        )
        cleaned = (raw_resp or "").strip()
        if cleaned.startswith("```"):
            cleaned = re.sub("^```[a-z]*\\n", "", cleaned)
            cleaned = re.sub("\\n```$", "", cleaned)
        data = json.loads(cleaned.strip())
        return {"status": "ok", "result": data}
    except Exception as e:
        _legacy.log.error(f"Error generating button action: {e}")
        return {
            "status": "ok",
            "result": {
                "button_label": "Acció IA",
                "button_action": "ai_prompt",
                "button_config": {
                    "prompt": user_prompt,
                    "target_field": field_names[0] if field_names else "title",
                },
            },
        }


@router.post(
    "/skills/execute-button-action",
    dependencies=[_legacy.Depends(_legacy.require_role("editor"))],
    response_model=None,
)
async def execute_button_action(
    payload: dict[_LegacyAny, _LegacyAny] = _legacy.Body(...),
) -> _LegacyAny:
    """Executes a custom AI prompt or Skill button action on a note/row."""
    note_id = (payload.get("note_id") or "").strip()
    button_action = (payload.get("button_action") or "").strip()
    button_config = payload.get("button_config") or {}
    if not note_id:
        raise _legacy.HTTPException(status_code=400, detail="note_id is required")
    file_path = await _legacy.asyncio.to_thread(_legacy.find_page_path, note_id)
    if not file_path or not file_path.exists():
        raise _legacy.HTTPException(status_code=404, detail=f"Page not found (ID: {note_id})")
    raw_content = await _legacy.asyncio.to_thread(file_path.read_text, encoding="utf-8")
    metadata, body = _legacy.parse_frontmatter(raw_content, file_path)
    title = metadata.get("title") or file_path.stem
    if button_action == "ai_prompt":
        user_prompt = (button_config.get("prompt") or "").strip()
        target_field = (button_config.get("target_field") or "").strip()
        if not user_prompt:
            raise _legacy.HTTPException(
                status_code=400, detail="Prompt is required for ai_prompt action"
            )
        if not target_field:
            raise _legacy.HTTPException(
                status_code=400, detail="target_field is required for ai_prompt action"
            )
        import json

        from backend.agent.factory import generate_text

        context_str = f"Title: {title}\nMetadata: {json.dumps(metadata, ensure_ascii=False)}\nContent: {body[:1000]}"
        full_instruction = f"Task: {user_prompt}\nProvide ONLY the result value to set for field '{target_field}'. Do not include formatting or commentary unless requested."
        output_val, _ = await _legacy.asyncio.to_thread(
            generate_text, full_instruction, context_str
        )
        cleaned_val = (output_val or "").strip()
        metadata[target_field] = cleaned_val
        metadata["last_edited_at"] = _legacy.datetime.now().isoformat()
        _legacy.save_page_md(file_path, metadata, body)
        return {
            "status": "ok",
            "note_id": note_id,
            "updated_field": target_field,
            "value": cleaned_val,
            "metadata": metadata,
        }
    else:
        raise _legacy.HTTPException(
            status_code=400,
            detail=f"Unsupported button_action for server execution: {button_action}",
        )


@router.post(
    "/skills/translate-page",
    dependencies=[
        _legacy.Depends(_legacy.require_role("editor")),
        _legacy.Depends(_legacy.require_plugins("translation")),
    ],
    response_model=None,
)
async def translate_page(
    background_tasks: _legacy.BackgroundTasks,
    payload: dict[_LegacyAny, _LegacyAny] = _legacy.Body(...),
) -> _LegacyAny:
    """Translate a Vault page (title + markdown body) into one child page per language.

    Body:
        {
          "page_id": "<uuid of the page>",
          "target_languages": ["en", "es", ...],
          "button_action": "translate_page"  # validated; rejects others
        }

    For each target language a child page is created (`parent_id = page_id`) with the
    translated title and body. Gnosi's enriched-markdown directives (code fences, `:::`
    blocks, wikilinks, citations, bibliography, transclusions) are preserved by the
    `translate_page` skill's segmenter. Mirrors `translate_row` but for whole documents.
    """
    return await _legacy.translation_page_service.translate_page(
        background_tasks, payload, _legacy._PAGE_TRANSLATION_DEPENDENCIES
    )
