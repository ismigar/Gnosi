"""Reader list plans avoid full table scans and preserve every article column."""

import sqlite3

import pytest

from backend.migrations.runner import _run_alembic


@pytest.fixture
def reader_database(tmp_path):
    path = tmp_path / "reader.sqlite"
    _run_alembic(path, "upgrade", "vault_0004")
    with sqlite3.connect(path) as connection:
        connection.execute("INSERT INTO feed_sources(id, name, url) VALUES (1, 'Feed', 'https://example.test/feed')")
        connection.executemany(
            """INSERT INTO articles(id, source_id, title, url, content, full_content,
            published_at, is_read, created_at) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?)""",
            [(index, f"Article {index}", f"https://example.test/{index}", "Summary", "Full body",
              f"2026-09-{index % 28 + 1:02} 10:00:00", index % 2, "2026-09-01 00:00:00")
             for index in range(1, 101)],
        )
        before = connection.execute("SELECT * FROM articles ORDER BY id").fetchall()
    _run_alembic(path, "upgrade", "vault_0006")
    with sqlite3.connect(path) as connection:
        assert connection.execute("SELECT * FROM articles ORDER BY id").fetchall() == before
    return path


@pytest.mark.parametrize("where, expected_index", [
    ("", "ix_articles_published_at"),
    ("WHERE is_read = 0", "ix_articles_unread_published_at"),
    ("WHERE source_id = 1", "ix_articles_source_published_at"),
    ("WHERE source_id = 1 AND is_read = 0", "ix_articles_inventory"),
])
def test_reader_uses_ordered_indexes(reader_database, where, expected_index):
    with sqlite3.connect(reader_database) as connection:
        plan = connection.execute(
            f"EXPLAIN QUERY PLAN SELECT * FROM articles {where} ORDER BY published_at DESC LIMIT 50"
        ).fetchall()
    details = " ".join(str(row[3]) for row in plan)
    assert expected_index in details
    assert "USE TEMP B-TREE" not in details


@pytest.mark.parametrize("projection, joins", [
    ("COUNT(DISTINCT articles.source_id)", ""),
    ("MIN(articles.published_at), MAX(articles.published_at)", ""),
    ("feed_sources.id, COUNT(articles.id)", "JOIN feed_sources ON articles.source_id=feed_sources.id"),
])
def test_inventory_uses_covering_indexes(reader_database, projection, joins):
    with sqlite3.connect(reader_database) as connection:
        group_by = " GROUP BY feed_sources.id" if joins else ""
        plan = connection.execute(
            f"EXPLAIN QUERY PLAN SELECT {projection} FROM articles {joins} WHERE articles.is_read IS 0{group_by}"
        ).fetchall()
        assert connection.execute(
            "SELECT COUNT(DISTINCT source_id), COUNT(*) FROM articles WHERE is_read IS 0"
        ).fetchone() == (1, 50)
    article_reads = [str(row[3]) for row in plan if 'articles USING' in str(row[3])]
    assert article_reads and all('COVERING INDEX' in read for read in article_reads)
