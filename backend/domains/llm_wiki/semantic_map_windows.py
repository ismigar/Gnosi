"""Split only incomplete map windows, preserving complete cached siblings."""
from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from backend.domains.llm_wiki.semantic_reading import SemanticReader


class MapOutputLimit(RuntimeError):
    def __init__(self, has_answer: bool) -> None:
        self.has_answer = has_answer
        super().__init__('reading_prose_output_limit: the argument map is incomplete')


def ensure_complete(text: str, metadata: dict[str, Any]) -> None:
    incomplete = metadata.get('incomplete_details') or {}
    if (metadata.get('finish_reason') == 'length' or metadata.get('stop_reason') == 'max_tokens'
            or (isinstance(incomplete, dict) and incomplete.get('reason') == 'max_output_tokens')):
        raise MapOutputLimit(bool(text.strip()))


def split_material(material: list[Any]) -> tuple[list[Any], list[Any]] | None:
    if len(material) > 1:
        middle = len(material) // 2
        return material[:middle], material[middle:]
    if material and isinstance(material[0], str) and len(material[0]) > 1024:
        text = material[0]
        middle = text.rfind('\n', 0, len(text) // 2)
        if middle < len(text) // 4:
            middle = len(text) // 2
        return [text[:middle]], [text[middle:]]
    return None


def map_windows(engine: SemanticReader, key: str, material: list[Any], depth: int = 0) -> list[str]:
    splits = engine.state.setdefault('map_splits', {})
    if key not in splits:
        try:
            return [engine.summarize(key, material)]
        except MapOutputLimit as error:
            if not error.has_answer or depth >= 8 or split_material(material) is None:
                raise
            splits[key] = True
            engine.save()
    parts = split_material(material)
    if parts is None:
        raise RuntimeError('The saved argument-map split is incompatible with its source')
    left, right = parts
    return [*map_windows(engine, key + '-a', left, depth + 1),
            *map_windows(engine, key + '-b', right, depth + 1)]
