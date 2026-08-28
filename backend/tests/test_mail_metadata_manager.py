from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from backend.services.mail_metadata_manager import MailMetadataManager


def test_mail_metadata_round_trip_uses_injected_data_file(tmp_path: Path) -> None:
    manager = MailMetadataManager(tmp_path / "nested" / "mail_metadata.json")

    result = manager.update_metadata("thread-1", {"read": True, "label": "work"})

    assert result == {"read": True, "label": "work"}
    assert manager.get_metadata("thread-1") == result


def test_mail_metadata_discards_invalid_entries_without_losing_valid_ones(
    tmp_path: Path,
) -> None:
    config_file = tmp_path / "mail_metadata.json"
    config_file.write_text(
        '{"thread-1": {"read": true}, "invalid": "not-an-object"}',
        encoding="utf-8",
    )

    manager = MailMetadataManager(config_file)

    assert manager.get_metadata("thread-1") == {"read": True}
    assert manager.get_metadata("invalid") == {}


def test_concurrent_mail_metadata_updates_preserve_all_fields(tmp_path: Path) -> None:
    manager = MailMetadataManager(tmp_path / "mail_metadata.json")

    with ThreadPoolExecutor(max_workers=8) as executor:
        list(
            executor.map(
                lambda index: manager.update_metadata("thread-1", {f"field-{index}": index}),
                range(20),
            )
        )

    assert manager.get_metadata("thread-1") == {
        f"field-{index}": index for index in range(20)
    }
