"""Offline token accounting with an explicit conservative fallback."""
from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from types import FunctionType
import base64
from typing import Any
import hashlib
import os
import tempfile
from pathlib import Path

from backend.config.data_dir import resolve_data_dir

_ENCODING_HASHES = {
    "cl100k_base": "223921b76ee99bde995b7ff738513eef100fb51d18c93597a113bcffe865b2a7",
    "o200k_base": "446a9538cb6c348e3516120d7c08b09f57c36495e2acfffe59a5bf8b0cfb1a2d",
}


class OperationContextExceeded(RuntimeError):
    """An operation was rejected before making a model call."""

    def __init__(self) -> None:
        super().__init__("agent_operation_context_exceeded")


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


def _encoding_from_verified_bytes(name: str, raw: bytes) -> Any:
    """Use the pinned tokenizer's own pattern and special tokens, with no I/O."""
    from tiktoken import Encoding
    from tiktoken_ext import openai_public  # type: ignore[import-untyped]

    factory = getattr(openai_public, name, None)
    expected = _ENCODING_HASHES[name]
    if factory is None or expected not in factory.__code__.co_consts:
        raise ValueError("Unsupported tokenizer factory")
    ranks = {
        base64.b64decode(token, validate=True): int(rank)
        for token, rank in (line.split() for line in raw.splitlines() if line)
    }

    def load_verified(_url: str, *, expected_hash: str) -> dict[bytes, int]:
        if expected_hash != expected:
            raise ValueError("Unexpected tokenizer vocabulary")
        return ranks

    # A private copy binds the factory to the bytes already verified by the
    # caller. Never patch tiktoken globals or re-open the cache through its
    # downloader (the file could disappear between verification and use).
    offline_factory = FunctionType(
        factory.__code__, {**factory.__globals__, "load_tiktoken_bpe": load_verified},
    )
    return Encoding(**offline_factory())


_LOCAL_ENCODINGS: dict[tuple[str, Path], Any] = {}


def _available_encoding(model: str, *, use_profile_cache: bool = False) -> Any:
    from tiktoken.model import encoding_name_for_model
    from tiktoken.registry import ENCODINGS

    name = encoding_name_for_model(model)
    if name in ENCODINGS:
        return ENCODINGS[name]
    expected = _ENCODING_HASHES.get(name)
    override = os.environ.get("TIKTOKEN_CACHE_DIR", os.environ.get("DATA_GYM_CACHE_DIR"))
    if not expected or override == "":
        return None
    if override is not None:
        directories = [Path(override)]
    else:
        directories = [Path(tempfile.gettempdir()) / "data-gym-cache"]
        if use_profile_cache:
            directories.insert(0, resolve_data_dir() / "cache" / "tokenizers")

    url = f"https://openaipublic.blob.core.windows.net/encodings/{name}.tiktoken"
    cache_name = hashlib.sha1(url.encode()).hexdigest()
    for directory in directories:
        key = (name, directory)
        if key in _LOCAL_ENCODINGS:
            return _LOCAL_ENCODINGS[key]
        try:
            raw = (directory / cache_name).read_bytes()
        except OSError:
            continue
        if hashlib.sha256(raw).hexdigest() == expected:
            encoding = _encoding_from_verified_bytes(name, raw)
            _LOCAL_ENCODINGS[key] = encoding
            return encoding
    return None


def reading_price_counter(provider: str, model: str) -> tuple[Callable[[str], int], str]:
    """Select an offline tokenizer once for a reading quote, not execution limits."""
    openai_route = provider == "openai" or (provider == "openrouter" and model.startswith("openai/"))
    if openai_route:
        # Unknown model IDs have no certified encoding in the installed tiktoken.
        # Use a reference tokenizer for pricing only, never for safety checks.
        for candidate, kind in ((model.removeprefix("openai/"), "model"), ("gpt-4o", "reference")):
            try:
                encoding = _available_encoding(candidate, use_profile_cache=True)
            except (ImportError, KeyError, ValueError, OSError):
                continue
            if encoding is not None:
                return lambda text: len(encoding.encode(text, disallowed_special=())), f"{kind}:tiktoken:{encoding.name}"
    return lambda text: len(text.encode("utf-8")), "utf8-conservative-upper-bound"


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
