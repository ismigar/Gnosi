"""Opt-in, bounded smoke tests for authorized academic metadata services."""
from __future__ import annotations

import asyncio
import os

import pytest

from backend.services import academic_connectors, literature_service


pytestmark = pytest.mark.skipif(
    os.environ.get("GNOSI_RUN_LITERATURE_LIVE") != "1",
    reason="Live academic repository smoke tests are opt-in.",
)


@pytest.mark.parametrize("source_id", ["crossref", "datacite", "europe-pmc", "pubmed"])
def test_authorized_public_search_connector_returns_canonical_work(source_id):
    credential = os.environ.get("GNOSI_LITERATURE_CONTACT_EMAIL", "gnosi-ci@example.org") if source_id == "pubmed" else ""
    works = asyncio.run(
        academic_connectors.search_source(
            source_id,
            "open science",
            {},
            1,
            credential=credential,
        )
    )
    assert works
    assert works[0]["title"]
    assert works[0]["sources"][0]["provider"] == source_id


def test_dialnet_first_oai_page_is_parseable():
    source = next(item for item in literature_service.SOURCE_CATALOG if item["id"] == "dialnet-articles")
    page = asyncio.run(academic_connectors.fetch_oai_page(source))
    assert page["works"]
    assert page["resumption_token"]
    assert page["works"][0]["sources"][0]["provider"] == "dialnet-articles"
