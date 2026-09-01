"""Locale and safety contracts for the community release kit."""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
FILES = {
    "en": ROOT / "docs/community/community-release.md",
    "ca": ROOT / "docs/community/community-release.ca.md",
    "es": ROOT / "docs/community/community-release.es.md",
    "fr": ROOT / "docs/community/community-release.fr.md",
}
LINKS = {
    "community-release.md",
    "community-release.ca.md",
    "community-release.es.md",
    "community-release.fr.md",
}


def test_community_release_kit_has_four_reciprocally_linked_locales() -> None:
    for locale, path in FILES.items():
        source = path.read_text(encoding="utf-8")
        for link in LINKS:
            assert f"]({link})" in source, (locale, link)


def test_community_release_kit_keeps_beta_and_unsigned_disclosure() -> None:
    expected = {
        "en": ("beta", "unsigned"),
        "ca": ("beta", "no estan signades"),
        "es": ("beta", "no están firmadas"),
        "fr": ("bêta", "ne sont pas signés"),
    }
    for locale, phrases in expected.items():
        source = FILES[locale].read_text(encoding="utf-8")
        for phrase in phrases:
            assert phrase in source, (locale, phrase)
