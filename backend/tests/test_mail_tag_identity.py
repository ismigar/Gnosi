"""Synthetic persistence coverage for provider-scoped mail tags."""

from __future__ import annotations

import asyncio
import importlib
import sqlite3
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from backend.domains.mail.routes.tags import (
    get_message_tags,
    get_tags_for_messages,
    set_message_tags,
)
from backend.domains.mail.schemas import (
    MailMessageIdentityScope,
    MailMessageTagDescriptor,
    MailMessageTagsSetSchema,
    MailTagsBatchRequest,
)
from backend.domains.mail.tag_identity import (
    legacy_mail_tag_identity,
    scoped_mail_tag_identity,
)
from backend.migrations.runner import _run_alembic, ensure_database_schema
from backend.models.mail import MailMessageTag, MailTag


def _session() -> Session:
    engine = create_engine("sqlite:///:memory:")
    MailTag.__table__.create(engine)
    MailMessageTag.__table__.create(engine)
    session = sessionmaker(bind=engine)()
    session.add_all(
        [
            MailTag(id="tag-a", name="Alpha"),
            MailTag(id="tag-b", name="Beta"),
            MailTag(id="tag-c", name="Gamma"),
        ]
    )
    session.commit()
    return session


def _scope(account: str, folder: str) -> MailMessageIdentityScope:
    return MailMessageIdentityScope(
        account_email=account,
        source="imap",
        imap_folder=folder,
        imap_uid="42",
    )


def _descriptor(account: str, folder: str) -> MailMessageTagDescriptor:
    return MailMessageTagDescriptor(
        message_id="shared-id",
        account_email=account,
        source="imap",
        imap_folder=folder,
        imap_uid="42",
    )


def _set_scoped(
    session: Session,
    account: str,
    folder: str,
    tag_ids: list[str],
) -> dict[str, object]:
    payload = MailMessageTagsSetSchema(
        tag_ids=tag_ids,
        account_email=account,
        identity_scope=_scope(account, folder),
    )
    return asyncio.run(set_message_tags("shared-id", payload, session))


def _get_scoped(session: Session, account: str, folder: str) -> list[str]:
    return asyncio.run(
        get_message_tags(
            "shared-id",
            account_email=account,
            source="imap",
            imap_folder=folder,
            imap_uid="42",
            db=session,
        )
    )


def test_scoped_tag_routes_isolate_colliding_accounts_and_folders() -> None:
    session = _session()
    _set_scoped(session, "first@example.test", "INBOX", ["tag-a"])
    _set_scoped(session, "first@example.test", "Archive", ["tag-b"])
    _set_scoped(session, "second@example.test", "INBOX", ["tag-c"])

    assert _get_scoped(session, "first@example.test", "INBOX") == ["tag-a"]
    assert _get_scoped(session, "first@example.test", "Archive") == ["tag-b"]
    assert _get_scoped(session, "second@example.test", "INBOX") == ["tag-c"]

    descriptors = [
        _descriptor("first@example.test", "INBOX"),
        _descriptor("first@example.test", "Archive"),
        _descriptor("second@example.test", "INBOX"),
    ]
    result = asyncio.run(
        get_tags_for_messages(MailTagsBatchRequest(messages=descriptors), session)
    )
    expected = {
        scoped_mail_tag_identity(
            item.message_id,
            account_email=item.account_email,
            source=item.source,
            imap_folder=item.imap_folder,
            imap_uid=item.imap_uid,
        ).key: [tag_id]
        for item, tag_id in zip(descriptors, ("tag-a", "tag-b", "tag-c"), strict=True)
    }
    assert result == expected


def test_scoped_set_replaces_unique_legacy_tags_exactly() -> None:
    session = _session()
    first_identity = legacy_mail_tag_identity(
        "shared-id",
        "first@example.test",
    )
    second_identity = legacy_mail_tag_identity(
        "shared-id",
        "second@example.test",
    )
    session.add_all([
        _legacy_row(first_identity, "first@example.test", "tag-a"),
        _legacy_row(first_identity, "first@example.test", "tag-b"),
        _legacy_row(second_identity, "second@example.test", "tag-c"),
    ])
    session.commit()

    legacy = asyncio.run(
        get_tags_for_messages(
            MailTagsBatchRequest(message_ids=["shared-id"]),
            session,
        )
    )
    assert sorted(legacy["shared-id"]) == ["tag-a", "tag-b", "tag-c"]
    assert _get_scoped(session, "first@example.test", "INBOX") == [
        "tag-a",
        "tag-b",
    ]

    response = _set_scoped(
        session,
        "first@example.test",
        "INBOX",
        ["tag-b"],
    )

    assert response["tag_ids"] == ["tag-b"]
    assert _get_scoped(session, "first@example.test", "INBOX") == ["tag-b"]
    legacy_after = asyncio.run(
        get_tags_for_messages(
            MailTagsBatchRequest(message_ids=["shared-id"]),
            session,
        )
    )
    assert legacy_after["shared-id"] == ["tag-c"]


def _legacy_row(
    identity: str,
    account: str,
    tag_id: str,
) -> MailMessageTag:
    return MailMessageTag(
        message_identity=identity,
        message_id="shared-id",
        tag_id=tag_id,
        identity_kind="legacy",
        account_email=account,
    )


def test_scoped_set_empty_removes_unique_legacy_without_recreating_scope() -> None:
    session = _session()
    legacy_identity = legacy_mail_tag_identity(
        "shared-id",
        "first@example.test",
    )
    session.add_all([
        _legacy_row(legacy_identity, "first@example.test", "tag-a"),
        _legacy_row(legacy_identity, "first@example.test", "tag-b"),
    ])
    session.commit()

    response = _set_scoped(session, "first@example.test", "INBOX", [])

    assert response["tag_ids"] == []
    assert _get_scoped(session, "first@example.test", "INBOX") == []
    assert session.query(MailMessageTag).count() == 0


def test_scoped_set_leaves_ambiguous_and_incomplete_legacy_untouched() -> None:
    session = _session()
    session.add_all([
        _legacy_row("legacy-candidate-a", "first@example.test", "tag-a"),
        _legacy_row("legacy-candidate-b", "first@example.test", "tag-b"),
        _legacy_row("legacy-incomplete", "", "tag-c"),
    ])
    session.commit()

    assert _get_scoped(session, "first@example.test", "INBOX") == []
    _set_scoped(session, "first@example.test", "INBOX", ["tag-c"])

    assert _get_scoped(session, "first@example.test", "INBOX") == ["tag-c"]
    legacy = session.query(MailMessageTag).filter(
        MailMessageTag.identity_kind == "legacy"
    ).all()
    assert {str(row.message_identity) for row in legacy} == {
        "legacy-candidate-a",
        "legacy-candidate-b",
        "legacy-incomplete",
    }


def test_existing_scope_takes_precedence_and_never_merges_legacy() -> None:
    session = _session()
    _set_scoped(session, "first@example.test", "INBOX", ["tag-b"])
    legacy_identity = legacy_mail_tag_identity(
        "shared-id",
        "first@example.test",
    )
    session.add_all([
        _legacy_row(legacy_identity, "first@example.test", "tag-a"),
        _legacy_row(legacy_identity, "first@example.test", "tag-b"),
    ])
    session.commit()

    assert _get_scoped(session, "first@example.test", "INBOX") == ["tag-b"]

    response = _set_scoped(
        session,
        "first@example.test",
        "INBOX",
        ["tag-c"],
    )

    assert response["tag_ids"] == ["tag-c"]
    assert _get_scoped(session, "first@example.test", "INBOX") == ["tag-c"]
    assert session.query(MailMessageTag).filter(
        MailMessageTag.identity_kind == "legacy"
    ).count() == 0


def _make_2x_mail_tag_variant(database: Path) -> None:
    with sqlite3.connect(database) as connection:
        connection.executescript(
            """
            ALTER TABLE mail_message_tags RENAME TO mail_message_tags_original;
            CREATE TABLE mail_message_tags (
                message_id VARCHAR NOT NULL,
                tag_id VARCHAR NOT NULL,
                account_email VARCHAR NOT NULL DEFAULT '',
                subject VARCHAR NOT NULL DEFAULT '',
                sender VARCHAR NOT NULL DEFAULT '',
                date_str VARCHAR NOT NULL DEFAULT '',
                PRIMARY KEY (message_id, tag_id),
                FOREIGN KEY(tag_id) REFERENCES mail_tags (id) ON DELETE CASCADE
            );
            INSERT INTO mail_message_tags
                SELECT message_id, tag_id, COALESCE(account_email, ''),
                       COALESCE(subject, ''), COALESCE(sender, ''),
                       COALESCE(date_str, '')
                FROM mail_message_tags_original;
            DROP TABLE mail_message_tags_original;
            """
        )


@pytest.mark.parametrize("two_x_variant", [False, True])
def test_vault_migration_preserves_legacy_tags_and_verified_backup(
    tmp_path: Path,
    two_x_variant: bool,
) -> None:
    database = tmp_path / "system" / "vault_dbs" / "synthetic.db"
    database.parent.mkdir(parents=True)
    _run_alembic(database, "upgrade", "vault_0001")
    with sqlite3.connect(database) as connection:
        connection.execute(
            "INSERT INTO mail_tags(id,name,color) VALUES('tag-a','Alpha','#111111')"
        )
        connection.execute(
            "INSERT INTO mail_tags(id,name,color) VALUES('tag-b','Beta','#222222')"
        )
        connection.execute(
            """INSERT INTO mail_message_tags(
                message_id,tag_id,account_email,subject,sender,date_str
            ) VALUES('shared-id','tag-a','First@Example.Test','Subject','Sender','Date')"""
        )
        connection.execute(
            """INSERT INTO mail_message_tags(
                message_id,tag_id,account_email,subject,sender,date_str
            ) VALUES('global-id','tag-b',NULL,'Global subject','Global sender','Global date')"""
        )
    if two_x_variant:
        _make_2x_mail_tag_variant(database)

    result = ensure_database_schema(database, "vault", tmp_path)

    assert result["revision_before"] == "vault_0001"
    assert result["revision_after"] == "vault_0004"
    backup = tmp_path / result["backup"]["path"]
    with sqlite3.connect(backup) as connection:
        assert connection.execute("SELECT COUNT(*) FROM mail_message_tags").fetchone() == (2,)
        old_columns = {
            str(row[1]) for row in connection.execute("PRAGMA table_info(mail_message_tags)")
        }
        assert "message_identity" not in old_columns

    with sqlite3.connect(database) as connection:
        assert connection.execute("PRAGMA integrity_check").fetchone() == ("ok",)
        migrated = connection.execute(
            """SELECT message_identity,identity_kind,account_email,provider,
                      folder,provider_uid,subject,sender,date_str
               FROM mail_message_tags WHERE message_id='shared-id'"""
        ).fetchone()
        assert migrated == (
            legacy_mail_tag_identity("shared-id", "First@Example.Test"),
            "legacy",
            "First@Example.Test",
            None,
            None,
            None,
            "Subject",
            "Sender",
            "Date",
        )
        global_row = connection.execute(
            """SELECT message_identity,identity_kind,account_email,subject,sender,date_str
               FROM mail_message_tags WHERE message_id='global-id'"""
        ).fetchone()
        expected_global_account = "" if two_x_variant else None
        assert global_row == (
            legacy_mail_tag_identity("global-id", expected_global_account),
            "legacy",
            expected_global_account,
            "Global subject",
            "Global sender",
            "Global date",
        )
        assert connection.execute("SELECT COUNT(*) FROM mail_message_tags").fetchone() == (2,)

    migration = importlib.import_module(
        "backend.migrations.alembic.versions.vault_0004"
    )
    with pytest.raises(RuntimeError, match="verified backup"):
        migration.downgrade()
