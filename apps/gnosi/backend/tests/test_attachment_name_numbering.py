"""Numbering of attachment names when several files share one target name.

A `files` field with a name pattern interpolates the ROW's metadata, so every
file attached to the same row resolves to the same target name. The destination
must therefore be numbered ("Nom.pdf", "Nom-2.pdf", …) rather than overwritten
or suffixed with a random hash.
"""
import io
from pathlib import Path

import pytest

from backend.api.vault_routes import _numbered_candidate, _save_uploaded_file_to_dir


class _FakeUpload:
    """Minimal UploadFile stand-in: only `filename` and `file` are read."""

    def __init__(self, filename: str, payload: bytes):
        self.filename = filename
        self.file = io.BytesIO(payload)


def test_numbered_candidate_starts_unsuffixed():
    d = Path("/tmp/x")
    assert _numbered_candidate(d, "Nom", ".pdf", 1) == d / "Nom.pdf"
    assert _numbered_candidate(d, "Nom", ".pdf", 2) == d / "Nom-2.pdf"
    assert _numbered_candidate(d, "Nom", ".pdf", 10) == d / "Nom-10.pdf"


def test_batch_with_one_target_name_is_numbered_in_order(tmp_path):
    saved = [
        _save_uploaded_file_to_dir(
            _FakeUpload(f"original-{i}.pdf", f"file {i}".encode()),
            tmp_path,
            target_name="Autor - 2024 - Títol",
        )
        for i in range(3)
    ]
    assert [p.name for p in saved] == [
        "Autor - 2024 - Títol.pdf",
        "Autor - 2024 - Títol-2.pdf",
        "Autor - 2024 - Títol-3.pdf",
    ]
    # Every file keeps its own bytes: numbering must not overwrite.
    assert [p.read_text() for p in saved] == ["file 0", "file 1", "file 2"]


def test_existing_file_is_never_overwritten(tmp_path):
    (tmp_path / "Nom.pdf").write_text("ja hi era")
    dest = _save_uploaded_file_to_dir(_FakeUpload("x.pdf", b"nou"), tmp_path, target_name="Nom")
    assert dest.name == "Nom-2.pdf"
    assert (tmp_path / "Nom.pdf").read_text() == "ja hi era"


def test_without_target_name_the_original_stem_is_numbered(tmp_path):
    first = _save_uploaded_file_to_dir(_FakeUpload("informe.pdf", b"a"), tmp_path)
    second = _save_uploaded_file_to_dir(_FakeUpload("informe.pdf", b"b"), tmp_path)
    assert first.name == "informe.pdf"
    assert second.name == "informe-2.pdf"


@pytest.mark.parametrize("ext", ["", ".tar.gz"])
def test_extension_handling(tmp_path, ext):
    """Only the LAST suffix counts as the extension (Path.suffix), and a file
    with no extension still numbers cleanly."""
    dest = _save_uploaded_file_to_dir(_FakeUpload(f"a{ext}", b"x"), tmp_path, target_name="Nom")
    expected_ext = Path(f"a{ext}").suffix
    assert dest.name == f"Nom{expected_ext}"
