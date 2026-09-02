"""Synthetic tests for the conservative mail-analysis fallback."""

from backend.domains.mail.services.local_analysis import extract_local_entities


def test_extracts_only_explicitly_named_contacts_and_deduplicates() -> None:
    result = extract_local_entities(
        "Contacte: Ada Lovelace <ADA@example.test>\n"
        '<a href="mailto:ada@example.test">Ada duplicada</a>\n'
        '<a href="mailto:grace@example.test?subject=Hello">Grace Hopper</a>\n'
        "bare@example.test"
    )

    assert result.contacts == [
        {
            "name": "Ada Lovelace",
            "email": "ada@example.test",
            "phone": "",
            "company": "",
            "notes": "",
        },
        {
            "name": "Grace Hopper",
            "email": "grace@example.test",
            "phone": "",
            "company": "",
            "notes": "",
        },
    ]


def test_extracts_complete_literal_vevent_without_inference() -> None:
    result = extract_local_entities(
        r"""BEGIN:VEVENT
SUMMARY:Revisió explícita
DTSTART:20260903T093000Z
DTEND:20260903T103000Z
LOCATION:Sala 2
DESCRIPTION:Revisar el document\, sense inferir res
END:VEVENT"""
    )

    assert result.events == [
        {
            "title": "Revisió explícita",
            "start": "2026-09-03T09:30:00Z",
            "end": "2026-09-03T10:30:00Z",
            "location": "Sala 2",
            "description": "Revisar el document, sense inferir res",
        }
    ]


def test_rejects_prose_dates_incomplete_events_and_unnamed_addresses() -> None:
    result = extract_local_entities(
        "Demà a les deu amb bare@example.test\n"
        "BEGIN:VEVENT\nDTSTART:20260903T100000\nEND:VEVENT\n"
        "BEGIN:VEVENT\nSUMMARY:Data impossible\nDTSTART:20261340\nEND:VEVENT"
    )

    assert result.events == []
    assert result.contacts == []
