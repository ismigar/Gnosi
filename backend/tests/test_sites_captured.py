"""Real synthetic capture lifecycle through the PHP administrator boundary."""
import shutil
import subprocess
from pathlib import Path

import pytest


@pytest.mark.skipif(shutil.which("php") is None, reason="PHP is not installed")
def test_captured_mail_lifecycle_and_site_storage_isolation(tmp_path):
    root = Path(__file__).resolve().parents[2]
    result = subprocess.run(
        [shutil.which("php"), str(Path(__file__).parent / "fixtures/sites/captured.php"),
         str(root / "extensions/web-publishing/server/library.php")],
        cwd=tmp_path, capture_output=True, text=True, timeout=30, check=False,
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout == "Captured mail lifecycle and isolation checks passed\n"
