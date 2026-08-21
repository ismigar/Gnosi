from backend.services import literature_review_service


def test_dual_blind_current_decisions_replace_previous_entries():
    decisions = [
        {"id": "1", "reviewer_id": "alice", "phase": "title_abstract", "decision": "include", "resolution": False},
        {"id": "2", "reviewer_id": "alice", "phase": "title_abstract", "decision": "exclude", "resolution": False},
        {"id": "3", "reviewer_id": "bob", "phase": "title_abstract", "decision": "include", "resolution": False},
    ]
    current = literature_review_service._current_by_reviewer(decisions, "title_abstract")
    assert current["alice"]["id"] == "2"
    assert current["bob"]["id"] == "3"


def test_phase_progression_never_lets_ai_or_uncertain_decisions_advance():
    assert literature_review_service._next_phase("title_abstract", "include") == "full_text_requested"
    assert literature_review_service._next_phase("full_text_assessed", "include") == "included"
    assert literature_review_service._next_phase("title_abstract", "exclude") == "excluded"


def test_prisma_counts_are_deterministic_and_keep_exclusion_reasons():
    candidates = [
        {"phase": "excluded", "full_text": "not_requested"},
        {"phase": "included", "full_text": "available"},
        {"phase": "full_text_requested", "full_text": "unavailable"},
    ]
    decisions = [{"decision": "exclude", "reason": "Wrong population", "replaces_decision_id": None}]
    counts = literature_review_service.prisma_counts(candidates, decisions)
    assert counts["identified"] == 3
    assert counts["included"] == 1
    assert counts["reports_unavailable"] == 1
    assert counts["full_text_exclusions"] == {"Wrong population": 1}


def test_prisma_svg_escapes_review_titles():
    svg = literature_review_service._prisma_svg({
        "review": {"title": "Evidence <script>"},
        "prisma": {"identified": 2, "screened": 2, "reports_sought": 1, "included": 1, "title_abstract_excluded": 0, "reports_unavailable": 0},
    })
    assert "<script>" not in svg
    assert "Evidence &lt;script&gt;" in svg
