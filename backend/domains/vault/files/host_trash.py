"""Host adapter for recoverable physical-file deletion."""

from __future__ import annotations

import json
import urllib.error
import urllib.request


def try_host_trash_helper(
    target: str,
    timeout: float = 20.0,
    *,
    helper_url: str,
) -> tuple[bool, str]:
    """Ask the host helper to move one HOME-contained file to Trash."""
    try:
        request = urllib.request.Request(
            helper_url,
            data=json.dumps({"path": target}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=timeout) as response:
            if 200 <= response.status < 300:
                return True, ""
            return False, f"HTTP {response.status}"
    except urllib.error.HTTPError as exc:
        try:
            raw: object = json.loads(exc.read() or b"{}")
            detail = raw.get("detail", str(exc)) if isinstance(raw, dict) else str(exc)
        except Exception:
            detail = str(exc)
        return False, str(detail)
    except Exception as exc:
        return False, str(exc)


__all__ = ["try_host_trash_helper"]
