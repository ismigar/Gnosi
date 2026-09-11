"""Desktop listener overrides do not inherit a native service's fixed port."""

import pytest

from backend.config.desktop_server import desktop_server_address


def test_native_service_keeps_its_configured_address():
    assert desktop_server_address({"BACKEND_PORT": "43123"}) is None


def test_desktop_child_uses_parent_port_and_loopback_only():
    assert desktop_server_address({
        "GNOSI_DESKTOP_INSTANCE": "a" * 64, "BACKEND_PORT": "43123",
    }) == ("127.0.0.1", 43123)


@pytest.mark.parametrize("port", ["", "0", "65536", "-1", "123x", " 123", "1.5"])
def test_invalid_desktop_port_fails_closed(port):
    with pytest.raises(ValueError, match="port"):
        desktop_server_address({"GNOSI_DESKTOP_INSTANCE": "a" * 64, "BACKEND_PORT": port})


def test_invalid_instance_fails_closed():
    with pytest.raises(ValueError, match="identity"):
        desktop_server_address({"GNOSI_DESKTOP_INSTANCE": "other", "BACKEND_PORT": "43123"})


def test_real_server_entrypoint_overrides_conflicting_config(monkeypatch):
    """Exercise the shipped entrypoint without importing application/user state."""
    import runpy
    import sys
    import types
    from pathlib import Path

    calls = []
    replacements = {
        "uvicorn": {"run": lambda *args, **kwargs: calls.append(kwargs)},
        "backend.config.startup_vault": {"materialize_startup_vault_files": lambda: None},
        "backend.app.factory": {"create_app": lambda lifespan: object()},
        "backend.app.lifespan": {"lifespan": object()},
        "backend.config.app_config": {
            "load_params": lambda **kwargs: {"server": {"host": "0.0.0.0", "backend_port": 5002}},
        },
        "backend.config.env_config": {"is_frozen_runtime": lambda: True},
    }
    for name, attributes in replacements.items():
        module = types.ModuleType(name)
        module.__dict__.update(attributes)
        monkeypatch.setitem(sys.modules, name, module)
    monkeypatch.setenv("GNOSI_DESKTOP_INSTANCE", "a" * 64)
    monkeypatch.setenv("BACKEND_PORT", "43123")
    runpy.run_path(str(Path(__file__).parents[1] / "server.py"), run_name="__main__")
    assert calls == [{"host": "127.0.0.1", "port": 43123, "reload": False}]
