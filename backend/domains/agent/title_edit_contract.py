"""Bounded title transformations: model proposals are data, never executable code."""
from __future__ import annotations

import re
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class TitleCondition(BaseModel):
    model_config = ConfigDict(extra='forbid')
    kind: Literal['all', 'contains', 'starts_with', 'ends_with', 'equals']
    value: str = Field(max_length=160)

    @model_validator(mode='after')
    def meaningful(self) -> TitleCondition:
        if (self.kind == 'all') != (self.value == ''):
            raise ValueError('Use an empty value only for the all condition')
        return self

    def matches(self, title: str) -> bool:
        return {'all': True, 'contains': self.value in title,
                'starts_with': title.startswith(self.value),
                'ends_with': title.endswith(self.value), 'equals': title == self.value}[self.kind]


class TitleChange(BaseModel):
    model_config = ConfigDict(extra='forbid')
    kind: Literal['replace', 'numbered_replace', 'prefix', 'suffix', 'trim', 'lower', 'upper']
    source: str = Field(max_length=160)
    target: str = Field(max_length=160)
    position: Literal['any', 'start', 'end']

    @model_validator(mode='after')
    def operands(self) -> TitleChange:
        if self.kind in {'replace', 'numbered_replace'}:
            if not self.source or self.source == self.target:
                raise ValueError('Replacement needs distinct nonempty source and target')
        elif self.source or self.position != 'any':
            raise ValueError('Only replacements accept a source or an anchor')
        if self.kind in {'trim', 'lower', 'upper'} and self.target:
            raise ValueError('Case and whitespace changes have no target operand')
        if self.kind == 'numbered_replace':
            if self.source.count('{n}') != 1 or self.target.count('{n}') != 1:
                raise ValueError('Numbered replacements preserve exactly one {n} positive integer')
            if self.source == '{n}':
                raise ValueError('A numbered replacement needs literal context')
        return self

    def apply(self, title: str) -> str:
        if self.kind == 'prefix':
            return self.target + title
        if self.kind == 'suffix':
            return title + self.target
        if self.kind == 'trim':
            return title.strip()
        if self.kind == 'lower':
            return title.lower()
        if self.kind == 'upper':
            return title.upper()
        pattern = re.escape(self.source)
        if self.kind == 'numbered_replace':
            pattern = pattern.replace(re.escape('{n}'), r'([1-9][0-9]{0,8})(?![0-9])')
        pattern = ('^' if self.position == 'start' else '') + pattern + ('$' if self.position == 'end' else '')
        return re.sub(pattern, lambda match: self.target.replace('{n}', match[1])
                      if self.kind == 'numbered_replace' else self.target, title)


class TitleEdit(BaseModel):
    model_config = ConfigDict(extra='forbid')
    operation: Literal['transform_titles']
    field: Literal['title']
    scope: Literal['active_view', 'previous_view']
    condition: TitleCondition
    changes: list[TitleChange] = Field(min_length=1, max_length=8)

    def apply(self, title: str) -> str:
        if not self.condition.matches(title):
            return title
        result = title
        for change in self.changes:
            result = change.apply(result)
        if not result.strip() or len(result) > 2000 or any(c in result for c in '\r\n\x00'):
            raise ValueError('Invalid resulting title')
        return result


class ViewEditDecision(BaseModel):
    model_config = ConfigDict(extra='forbid')
    kind: Literal['edit', 'other', 'clarify']
    edit: TitleEdit | None
    question: str = Field(max_length=400)

    @model_validator(mode='before')
    @classmethod
    def discard_inactive_payload(cls, value: Any) -> Any:
        # Providers may fill inactive nullable branches of a strict schema.
        # A non-edit decision can never carry executable transformations.
        if isinstance(value, dict) and value.get('kind') in {'other', 'clarify'}:
            return {**value, 'edit': None, 'question': value.get('question', '') if value['kind'] == 'clarify' else ''}
        return value

    @model_validator(mode='after')
    def consistent(self) -> ViewEditDecision:
        if (self.kind == 'edit') != (self.edit is not None):
            raise ValueError('Only an edit decision includes a transformation')
        if (self.kind == 'clarify') != bool(self.question.strip()):
            raise ValueError('Only a clarification includes a question')
        return self


def state_title_edit(state: Any, request: str) -> TitleEdit | None:
    """Only the current server-created proposal can drive deterministic execution."""
    value = state.get('title_edit') or {}
    if not value:
        return None
    if value.get('request') != request or not value.get('view_scope'):
        raise ValueError('title_edit_request_mismatch')
    return TitleEdit.model_validate(value['program'])
