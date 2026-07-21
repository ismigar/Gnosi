"""default_host_helper_url(): the host helper default must follow the runtime.

The helper (host_open_helper, port 5099) always runs on the HOST. From inside
Docker it is reached via `host.docker.internal`; a native backend must use
loopback — the old unconditional Docker default made native installs silently
skip the helper (Spotlight search degraded to os.walk, host-trash returned
502). Same failure family as the warmup-mode autodetection (PR #838).
"""

from backend.config.env_config import default_host_helper_url


def test_docker_env_var_selects_host_gateway(monkeypatch):
    monkeypatch.setenv("DOCKER_CONTAINER", "1")
    assert (
        default_host_helper_url("/open")
        == "http://host.docker.internal:5099/open"
    )


def test_native_defaults_to_loopback(monkeypatch):
    # No DOCKER_CONTAINER and no /.dockerenv on dev/CI hosts → native.
    monkeypatch.delenv("DOCKER_CONTAINER", raising=False)
    assert default_host_helper_url("/search") == "http://127.0.0.1:5099/search"


def test_path_is_appended_verbatim(monkeypatch):
    monkeypatch.delenv("DOCKER_CONTAINER", raising=False)
    assert default_host_helper_url("/trash").endswith(":5099/trash")
