"""Compatibility-preserving request contracts for Vault skill routes."""

from __future__ import annotations

from collections.abc import Mapping

from pydantic import BaseModel, ConfigDict, JsonValue, SkipValidation


RawJson = SkipValidation[JsonValue | None]


class VaultSkillRequest(BaseModel):
    """Named request whose supplied values retain their raw 2.x representation."""

    model_config = ConfigDict(extra="allow")

    def as_payload(self) -> dict[str, object]:
        """Return exactly the supplied known and extension properties."""
        supplied = self.model_fields_set
        return {name: value for name, value in self if name in supplied}


class SyncDrupalRowRequest(VaultSkillRequest):
    item_id: RawJson = None
    button_action: RawJson = None
    publish: RawJson = None
    scope: RawJson = None
    push_media: RawJson = None


class SyncDrupalRowsRequest(VaultSkillRequest):
    item_ids: RawJson = None
    scope: RawJson = None
    publish: RawJson = None
    push_media: RawJson = None


class MatchDrupalRowsRequest(VaultSkillRequest):
    table_id: RawJson = None
    bundle: RawJson = None
    item_ids: RawJson = None
    dry_run: RawJson = None


class TranslateRowRequest(VaultSkillRequest):
    item_id: RawJson = None
    target_languages: RawJson = None
    button_action: RawJson = None


class TranslateRowsRequest(VaultSkillRequest):
    item_ids: RawJson = None
    target_languages: RawJson = None
    button_action: RawJson = None


class GenerateButtonActionRequest(VaultSkillRequest):
    prompt: RawJson = None
    fields: RawJson = None


class ExecuteButtonActionRequest(VaultSkillRequest):
    note_id: RawJson = None
    button_action: RawJson = None
    button_config: RawJson = None


class TranslatePageRequest(VaultSkillRequest):
    page_id: RawJson = None
    target_languages: RawJson = None
    button_action: RawJson = None


def request_payload(request: VaultSkillRequest | Mapping[str, object]) -> dict[str, object]:
    """Support FastAPI models and established direct domain callers."""
    if isinstance(request, VaultSkillRequest):
        return request.as_payload()
    return dict(request)


__all__ = [
    "ExecuteButtonActionRequest",
    "GenerateButtonActionRequest",
    "MatchDrupalRowsRequest",
    "SyncDrupalRowRequest",
    "SyncDrupalRowsRequest",
    "TranslatePageRequest",
    "TranslateRowRequest",
    "TranslateRowsRequest",
    "VaultSkillRequest",
    "request_payload",
]
