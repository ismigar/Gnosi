"""Blocking configuration helpers for the social domain."""

from __future__ import annotations

import copy
import html
import re
from typing import Any, cast

from backend.domains.social.schemas import SocialNetwork, Stream
from backend.services.integration_manager import integration_manager
from backend.services.social_clients import SOCIAL_PUBLISHERS

DEFAULT_STREAMS = [
    {"id": "mastodon-home", "title": "Mastodon Home", "icon": "🐘", "network": "mastodon"},
    {"id": "bluesky-home", "title": "Bluesky Home", "icon": "🦋", "network": "bluesky"},
    {"id": "scheduled", "title": "Programats", "icon": "📅", "network": "scheduled"},
]

DEFAULT_NETWORKS = [
    {"id": "mastodon", "name": "Mastodon", "icon": "🐘", "enabled": True},
    {"id": "bluesky", "name": "Bluesky", "icon": "🦋", "enabled": True},
    {"id": "linkedin", "name": "LinkedIn", "icon": "💼", "enabled": True},
    {"id": "facebook", "name": "Facebook", "icon": "📘", "enabled": False},
    {"id": "telegram", "name": "Telegram", "icon": "✈️", "enabled": False},
]


def strip_html(text: str) -> str:
    """Remove HTML tags and decode entities from a social feed item."""
    text = re.sub(r"<br\s*/?>", "\n", text)
    text = re.sub(r"<p>", "", text)
    text = re.sub(r"</p>", "\n\n", text)
    text = re.sub(r"<[^>]+>", "", text)
    return html.unescape(text).strip()


def network_settings(network: str) -> dict[str, Any]:
    """Return the stored per-network composition settings."""
    config = integration_manager._load()
    for item in config.get("social_networks", DEFAULT_NETWORKS):
        if item.get("id") == network:
            return cast(dict[str, Any], item)
    return {}


def configured_streams() -> list[Stream]:
    """Load and validate stream settings as one blocking operation."""
    config = integration_manager._load()
    return [
        Stream.model_validate(stream) for stream in config.get("social_streams", DEFAULT_STREAMS)
    ]


def _unconfigured_publisher_types() -> tuple[type[Any], ...]:
    from backend.services.social_clients import UnconfiguredPublisher

    return (UnconfiguredPublisher,)


def configured_networks() -> list[SocialNetwork]:
    """Load and enrich network settings as one blocking operation."""
    config = integration_manager._load()
    networks = copy.deepcopy(config.get("social_networks", DEFAULT_NETWORKS))
    for network in networks:
        client = SOCIAL_PUBLISHERS.get(network.get("id"))
        if client is not None:
            try:
                network["configured"] = bool(client.is_configured())
            except Exception:
                network["configured"] = False
            network["char_limit"] = getattr(client, "char_limit", 280)
            network["implemented"] = not isinstance(client, _unconfigured_publisher_types())
    return [SocialNetwork.model_validate(network) for network in networks]


__all__ = [
    "DEFAULT_NETWORKS",
    "configured_networks",
    "configured_streams",
    "network_settings",
    "strip_html",
]
