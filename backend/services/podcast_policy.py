"""Validated editorial preferences from the assigned, user-personalizable skill."""
from __future__ import annotations

import json
import re
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from backend.services.agent_behavior import ROOT as BEHAVIOR_ROOT


SKILL_ID = 'core.gnosi-daily-briefing'
TECHNICAL_MAX_TOPICS = 32
# A speech-length estimate, rather than an editorial duration default.
ESTIMATED_WORDS_PER_MINUTE = 138


class ShortDayPreferences(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True, frozen=True)
    full_episode_from_articles: int = Field(ge=1, le=10000)
    words_per_article: int = Field(ge=1, le=10000)
    minimum_words: int = Field(ge=1, le=10000)


class PodcastPreferences(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True, frozen=True)
    duration_minutes: int = Field(ge=1, le=60)
    max_topic_groups: int = Field(ge=1, le=TECHNICAL_MAX_TOPICS)
    review_mode: Literal['brief', 'full']
    short_day: ShortDayPreferences

    def word_target(self, article_count: int) -> int:
        target = self.duration_minutes * ESTIMATED_WORDS_PER_MINUTE
        if article_count >= self.short_day.full_episode_from_articles:
            return target
        return min(target, max(self.short_day.minimum_words,
                               self.short_day.words_per_article * article_count))


def _unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('podcast_skill_preferences_duplicate_key')
        result[key] = value
    return result


def _settings(instructions: str) -> dict[str, Any] | None:
    selected = []
    for match in re.finditer(r'^```json[ \t]*\r?\n(.*?)^```[ \t]*\r?$', instructions,
                             re.MULTILINE | re.DOTALL | re.IGNORECASE):
        block = match.group(1)
        if not re.search(r'(?<!\\)"podcast_preferences"\s*:', block, re.IGNORECASE):
            continue
        try:
            value = json.loads(block, object_pairs_hook=_unique_object)
        except ValueError as error:
            raise ValueError('podcast_skill_preferences_invalid_json') from error
        if not isinstance(value, dict) or set(value) != {'podcast_preferences'}:
            raise ValueError('podcast_skill_preferences_invalid_root')
        preferences = value['podcast_preferences']
        if not isinstance(preferences, dict):
            raise ValueError('podcast_skill_preferences_invalid_object')
        selected.append(preferences)
    if len(selected) > 1:
        raise ValueError('podcast_skill_preferences_multiple_blocks')
    if not selected and re.search(r'(?<!\\)"podcast_preferences"\s*:', instructions, re.IGNORECASE):
        raise ValueError('podcast_skill_preferences_invalid_block')
    return selected[0] if selected else None


def preferences(context: Any) -> PodcastPreferences:
    """Use only the canonical assigned skill; source articles cannot configure it."""
    existing = getattr(context, 'editorial_policy', None)
    if isinstance(existing, PodcastPreferences):
        return existing
    defaults = _settings((BEHAVIOR_ROOT / 'operations/podcast/SKILL.md').read_text(encoding='utf-8'))
    if defaults is None:
        raise ValueError('podcast_builtin_preferences_missing')
    snapshot = getattr(context, 'snapshot', None)
    assigned = getattr(snapshot, 'skill_instructions', {})
    custom = _settings(assigned.get(SKILL_ID, '')) if isinstance(assigned, dict) else None
    combined = {**defaults, **(custom or {})}
    if custom and isinstance(custom.get('short_day'), dict):
        combined['short_day'] = {**defaults['short_day'], **custom['short_day']}
    return PodcastPreferences.model_validate(combined)
