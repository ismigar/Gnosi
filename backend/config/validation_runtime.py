"""Explicit, fail-closed isolation for disposable runtime acceptance probes."""

from __future__ import annotations

import os
from pathlib import Path


def validation_runtime_enabled() -> bool:
    """Require all data selectors beneath the explicitly supplied probe root.

    This mode disables environment-file and credential-store access, without
    replacing the application, its authentication policy or its lifespan.
    """
    configured = os.environ.get("GNOSI_VALIDATION_ROOT")
    if configured is None:
        return False
    root = Path(configured)
    if not root.is_absolute() or not root.is_dir() or root == root.parent:
        raise RuntimeError("GNOSI_VALIDATION_ROOT must be an existing absolute probe directory")
    root = root.resolve()
    if root == root.parent:
        raise RuntimeError("GNOSI_VALIDATION_ROOT must not resolve to a filesystem root")
    for name, directory in (
        ("GNOSI_DATA_DIR", "data"),
        ("DIGITAL_BRAIN_VAULT_PATH", "vault"),
        ("VAULT_HOST_PATH", "vault"),
        ("HOME_HOST_PATH", "host"),
    ):
        candidate = Path(os.environ.get(name, ""))
        expected = root / directory
        if (not candidate.is_absolute() or candidate.resolve() != expected
                or not expected.is_dir() or expected.is_symlink()):
            raise RuntimeError(f"Isolated validation requires {name} inside its probe root")
    return True
