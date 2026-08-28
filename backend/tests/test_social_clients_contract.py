"""Typed contracts for social provider adapters."""

from __future__ import annotations

import pytest

from backend.services.social_clients import (
    SOCIAL_PUBLISHERS,
    BlueskyClient,
    MastodonClient,
    TelegramClient,
)


def test_mastodon_transform_normalizes_reblogs() -> None:
    posts = MastodonClient()._transform_posts(
        [
            {
                "id": "boost-1",
                "created_at": "2026-08-28T10:00:00Z",
                "account": {"display_name": "Booster"},
                "reblog": {
                    "account": {"display_name": "Author", "acct": "author"},
                    "content": "Hello",
                    "url": "https://example.test/post/1",
                },
            }
        ]
    )

    assert posts[0]["author"] == "Author"
    assert posts[0]["is_reblog"] is True
    assert posts[0]["reblog_by"] == "Booster"


def test_bluesky_transform_narrows_optional_repost_reason() -> None:
    posts = BlueskyClient()._transform_posts(
        [
            {
                "post": {
                    "uri": "at://did/app.bsky.feed.post/key",
                    "author": {"handle": "author.test"},
                    "record": {"text": "Hello"},
                },
                "reason": None,
            }
        ]
    )

    assert posts[0]["is_reblog"] is False
    assert posts[0]["url"].endswith("/key")


def test_telegram_configuration_reads_environment_dynamically(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = TelegramClient()
    monkeypatch.delenv("TELEGRAM_BOT_TOKEN", raising=False)
    monkeypatch.delenv("TELEGRAM_CHAT_ID", raising=False)
    assert client.is_configured() is False

    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "token")
    monkeypatch.setenv("TELEGRAM_CHAT_ID", "chat")
    assert client.is_configured() is True


def test_social_registry_exposes_uniform_publishers() -> None:
    assert {"mastodon", "bluesky", "telegram", "linkedin", "facebook", "instagram", "x"} <= set(
        SOCIAL_PUBLISHERS
    )
    for network, publisher in SOCIAL_PUBLISHERS.items():
        assert publisher.network == network
        assert callable(publisher.is_configured)
        assert callable(publisher.publish)
