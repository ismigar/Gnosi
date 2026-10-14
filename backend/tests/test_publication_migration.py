"""Publication storage upgrades existing installations without replacing shares."""

from __future__ import annotations

import sqlite3
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from backend.domains.vault.publishing.models import (
    PublicationPreview,
    PublicationRevision,
    PublicationSite,
)
from backend.migrations.runner import _run_alembic, ensure_database_schema


def test_publication_upgrade_preserves_shares_and_supports_runtime_models(tmp_path: Path) -> None:
    database = tmp_path / "system" / "management.sqlite"
    database.parent.mkdir()
    _run_alembic(database, "upgrade", "mgmt_0005")
    with sqlite3.connect(database) as connection:
        connection.execute(
            "INSERT INTO share_links (id, page_id, workspace_id, created_by, revoked) VALUES (?, ?, ?, ?, ?)",
            ("existing-share", "note", "workspace", "owner", 0),
        )

    result = ensure_database_schema(database, "management", tmp_path)
    assert result["revision_before"] == "mgmt_0005"
    assert result["revision_after"] == "mgmt_0007"
    assert result["backup"]["sha256"]
    with sqlite3.connect(database) as connection:
        assert connection.execute(
            "SELECT id, page_id, revoked FROM share_links"
        ).fetchall() == [("existing-share", "note", 0)]

    engine = create_engine(f"sqlite:///{database}")
    try:
        with Session(engine) as session:
            session.add(PublicationPreview(
                id="preview", owner_id="owner", workspace_id="workspace",
                vault_key="vault", expires_at=2000, payload="{}", source_ids='["note"]',
            ))
            session.add(PublicationSite(
                id="site", token="a" * 43, owner_id="owner", workspace_id="workspace",
                vault_key="vault", title="Published notes", source_ids='["note"]',
                revision=1, created_at=1000, updated_at=1000,
            ))
            session.add(PublicationRevision(site_id="site", revision=1, payload='{"snapshot":true}'))
            session.commit()
        with Session(engine) as session:
            site = session.get(PublicationSite, "site")
            assert site is not None and site.revoked is False and site.expires_at is None
            revision = session.get(PublicationRevision, ("site", 1))
            assert revision is not None and revision.payload == '{"snapshot":true}'
        assert ensure_database_schema(database, "management", tmp_path)["changed"] is False
    finally:
        engine.dispose()
