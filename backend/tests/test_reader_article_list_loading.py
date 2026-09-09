"""The lightweight Reader list preserves metadata and skips stored bodies."""

from datetime import datetime, timezone

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session

from backend.domains.reader.routes import get_articles
from backend.models.reader import Article, FeedSource


@pytest.fixture
def article_session():
    engine = create_engine("sqlite:///:memory:")
    FeedSource.__table__.create(engine)
    Article.__table__.create(engine)
    with Session(engine) as session:
        session.add_all([
            FeedSource(id=1, name="First source", url="https://example.test/one"),
            FeedSource(id=2, name="Second source", url="https://example.test/two"),
        ])
        session.add_all([
            Article(id=index, source_id=1 if index < 3 else 2, title=f"Article {index}",
                    url=f"https://example.test/article/{index}", content="Feed summary",
                    full_content="Complete article text", is_read=index == 1,
                    published_at=datetime(2026, 9, index, tzinfo=timezone.utc))
            for index in (1, 2, 3)
        ])
        session.commit()
        yield session, engine
    engine.dispose()


@pytest.mark.parametrize("unread, sources, expected", [(True, [1], [2]), (False, None, [3, 2, 1])])
def test_lightweight_list_retains_metadata_filters_and_order(article_session, unread, sources, expected):
    session, engine = article_session
    legacy = get_articles(unread, sources, 50, session)
    statements = []

    def capture(_connection, _cursor, statement, _params, _context, _many):
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", capture)
    summaries = get_articles(unread, sources, 50, session, include_content=False)
    assert [article.id for article in summaries] == expected
    assert [article.model_dump(exclude={"content", "full_content"}) for article in summaries] == [
        article.model_dump(exclude={"content", "full_content"}) for article in legacy
    ]
    assert all(article.content == "" and article.full_content is None for article in summaries)
    assert len(statements) == 1
    assert "articles.content" not in statements[0]
    assert "articles.full_content" not in statements[0]


def test_legacy_list_still_returns_complete_bodies(article_session):
    session, _engine = article_session
    article = get_articles(False, None, 1, session)[0]
    assert article.id == 3
    assert article.content == "Feed summary"
    assert article.full_content == "Complete article text"
