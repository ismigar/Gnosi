"""Legacy backend import paths must not hide an installed external SDK."""

from __future__ import annotations

import ast
import sys
from importlib.machinery import PathFinder
from pathlib import Path

import pytest


@pytest.mark.parametrize("backend_already_present", [False, True])
def test_server_bootstrap_preserves_external_sdk_precedence(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, backend_already_present: bool,
) -> None:
    server = Path(__file__).resolve().parents[1] / "server.py"
    vendor = tmp_path / "vendor"
    sdk = vendor / "mcp"
    sdk.mkdir(parents=True)
    (sdk / "__init__.py").write_text("ClientSession = object\n")
    # Exercise the real bootstrap statements, before application creation or
    # cloud-file materialization. No runtime or inference is started.
    prefix = []
    for node in ast.parse(server.read_text()).body:
        if isinstance(node, ast.ImportFrom) and (node.module or "").startswith("backend."):
            break
        prefix.append(node)
    monkeypatch.setattr(sys, "path", [str(vendor), *[
        path for path in sys.path if path != str(server.parent)
    ]])
    if backend_already_present:
        sys.path.insert(0, str(server.parent))
    exec(compile(ast.Module(body=prefix, type_ignores=[]), str(server), "exec"), {"__file__": str(server)})
    spec = PathFinder.find_spec("mcp", sys.path)
    assert spec is not None and spec.origin == str(sdk / "__init__.py")
    assert str(server.parent) in sys.path
    assert str(server.parent.parent) in sys.path
