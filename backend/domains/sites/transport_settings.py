"""Normalize settings supplied by the maintained website SSH/Suweb driver."""

from __future__ import annotations

from collections.abc import Mapping


def website_transport_settings(settings: Mapping[str, str]) -> dict[str, str]:
    """Keep the external driver's historical path key at the adapter boundary.

    Existing registered Pangea drivers expose ``DRUPAL_PATH`` as their shell's
    working directory. This is a transport setting, independent of content sync.
    Gnosi's website sessions use the neutral ``WORKING_DIRECTORY`` key.
    """
    normalized = dict(settings)
    if "WORKING_DIRECTORY" not in normalized and "DRUPAL_PATH" in normalized:
        normalized["WORKING_DIRECTORY"] = normalized["DRUPAL_PATH"]
    normalized.pop("DRUPAL_PATH", None)
    return normalized
