"""Offline token accounting with an explicit conservative fallback."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any
import hashlib
import os
import tempfile
from pathlib import Path

_ENCODING_HASHES = {
    "cl100k_base": "223921b76ee99bde995b7ff738513eef100fb51d18c93597a113bcffe865b2a7",
    "o200k_base": "446a9538cb6c348e3516120d7c08b09f57c36495e2acfffe59a5bf8b0cfb1a2d",
}


def _available_encoding(model: str) -> Any:
    from tiktoken.model import encoding_name_for_model
    from tiktoken.registry import ENCODINGS, get_encoding
    name = encoding_name_for_model(model)
    if name in ENCODINGS:
        return ENCODINGS[name]
    expected = _ENCODING_HASHES.get(name)
    cache = os.environ.get("TIKTOKEN_CACHE_DIR", os.environ.get("DATA_GYM_CACHE_DIR", str(Path(tempfile.gettempdir()) / "data-gym-cache")))
    if not expected or not cache:
        return None
    url = f"https://openaipublic.blob.core.windows.net/encodings/{name}.tiktoken"
    path = Path(cache) / hashlib.sha1(url.encode()).hexdigest()
    if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != expected:
        return None
    from tiktoken_ext import openai_public  # type: ignore[import-untyped]
    constructor = getattr(openai_public, name, None)
    if constructor is None or expected not in constructor.__code__.co_consts:
        return None
    return get_encoding(name)


@dataclass(frozen=True)
class TokenCount:
    tokens: int
    method: str
    estimated: bool


def count_tokens(text: str, model: str = "") -> TokenCount:
    # Reuse an already available tokenizer; counting never downloads model assets.
    try:
        encoding = _available_encoding(model)
        if encoding is not None:
            return TokenCount(len(encoding.encode(text, disallowed_special=())), "tiktoken:" + encoding.name, False)
    except (ImportError, KeyError, ValueError, OSError):
        pass
    return TokenCount(len(text.encode("utf-8")), "utf8-conservative-upper-bound", True)


def messages_budget(messages: list[Any], model: str, window: int, tools: Any = None) -> dict[str, Any]:
    import json
    content = json.dumps([message.model_dump(mode="json") if hasattr(message, "model_dump") else message for message in messages], ensure_ascii=False)
    if tools:
        content += json.dumps(tools, ensure_ascii=False)
    measured = count_tokens(content, model)
    reserve = max(2048, window // 4)
    return {"input_tokens": measured.tokens, "response_reserve": reserve,
            "framing_reserve": 512, "window": window,
            "method": measured.method, "estimated": measured.estimated,
            "fits": measured.tokens + reserve + 512 <= window}
