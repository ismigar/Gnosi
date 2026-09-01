from __future__ import annotations

import base64
from pathlib import Path

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from extensions.examples import build_index


def _keypair() -> tuple[str, str]:
    private_key = Ed25519PrivateKey.generate()
    return (
        base64.b64encode(private_key.private_bytes_raw()).decode("ascii"),
        base64.b64encode(private_key.public_key().public_bytes_raw()).decode("ascii"),
    )


def test_official_plugin_index_fails_without_signing_key(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("GNOSI_PLUGIN_SIGNING_KEY", raising=False)
    with pytest.raises(RuntimeError, match="is required"):
        build_index.build(
            Path(build_index.__file__).parent,
            "https://example.test/assets",
            tmp_path,
            ["hello-command"],
        )
    assert list(tmp_path.iterdir()) == []


def test_unsigned_plugin_index_requires_explicit_local_flag(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("GNOSI_PLUGIN_SIGNING_KEY", raising=False)
    result = build_index.build(
        Path(build_index.__file__).parent,
        "https://example.test/assets",
        tmp_path,
        ["hello-command"],
        allow_unsigned=True,
    )
    assert result["signed"] is False
    assert not (tmp_path / "plugins-index.sig").exists()


def test_plugin_index_uses_matching_signing_key(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    private_key, public_key = _keypair()
    monkeypatch.setenv("GNOSI_PLUGIN_SIGNING_KEY", private_key)
    result = build_index.build(
        Path(build_index.__file__).parent,
        "https://example.test/assets",
        tmp_path,
        ["hello-command"],
        expected_public_key=public_key,
    )
    assert result["signed"] is True
    assert (tmp_path / "plugins-index.sig").read_text(encoding="ascii")
