"""Serve selected PDFs larger than PHP's heap without truncation or buffering."""
import hashlib
import os
from pathlib import Path
import shutil
import socket
import subprocess
import time
import urllib.error
import urllib.request

import pytest


def test_local_preview_streams_large_pdf_with_small_php_heap(tmp_path):
    php = shutil.which("php")
    if php is None:
        pytest.skip("PHP is required for the actual loopback preview")
    asset = tmp_path / "large.pdf"
    block = b"%PDF-1.7\n" + bytes(range(256)) * 4096
    expected = hashlib.sha256()
    with asset.open("wb") as stream:
        for _ in range(64):
            stream.write(block)
            expected.update(block)
    router = Path(__file__).resolve().parents[2] / "extensions/web-publishing/public/router.php"
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    origin = f"http://127.0.0.1:{port}/large.pdf"
    with (tmp_path / "php.log").open("wb") as log:
        process = subprocess.Popen(
            [php, "-d", "memory_limit=16M", "-S", f"127.0.0.1:{port}",
             "-t", str(tmp_path), str(router)],
            env={**os.environ, "GNOSI_SITES_PUBLIC_ROOT": str(tmp_path),
                 "GNOSI_SITES_RELEASE_ROOT": "", "GNOSI_SITES_BASE_PATH": ""},
            stdout=log, stderr=log,
        )
        try:
            for attempt in range(80):
                try:
                    response = urllib.request.urlopen(
                        urllib.request.Request(origin, method="HEAD"), timeout=3,
                    )
                    break
                except urllib.error.URLError:
                    if attempt == 79:
                        raise
                    time.sleep(0.025)
            with response:
                assert response.status == 200
                assert response.headers["Content-Type"] == "application/pdf"
                assert int(response.headers["Content-Length"]) == asset.stat().st_size
                assert response.read() == b""
            actual = hashlib.sha256()
            total = 0
            with urllib.request.urlopen(origin, timeout=15) as response:
                assert int(response.headers["Content-Length"]) == asset.stat().st_size
                for chunk in iter(lambda: response.read(1024 * 1024), b""):
                    actual.update(chunk)
                    total += len(chunk)
            assert total == asset.stat().st_size
            assert actual.digest() == expected.digest()
            assert process.poll() is None
        finally:
            process.terminate()
            process.wait(timeout=5)
