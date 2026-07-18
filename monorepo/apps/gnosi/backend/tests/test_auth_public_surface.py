"""The public-endpoint allowlist must be exact.

Two failure modes matter and they pull in opposite directions: too narrow and
the watchdogs start getting 401s and restart the backend in a loop; too wide and
removing the legacy fallback protects nothing. Both directions are asserted.
"""
import pytest

from backend.services.auth_public_surface import is_public_endpoint


# --- must stay open ----------------------------------------------------------

@pytest.mark.parametrize(
    "method, path",
    [
        ("GET", "/api/health"),          # docker_watchdog.sh + compose healthcheck
        ("GET", "/api/config"),          # native_watchdog.sh
        ("POST", "/api/auth/login"),
        ("POST", "/api/auth/register"),
        ("POST", "/api/auth/bootstrap-credentials"),
        ("POST", "/api/auth/logout"),
        ("GET", "/api/auth/me"),
        ("GET", "/api/share/abc123"),    # token in the URL is the credential
        ("POST", "/api/public/clip"),    # PAT-authenticated
        ("GET", "/api/public/ping"),
    ],
)
def test_stays_public(method: str, path: str):
    assert is_public_endpoint(method, path) is True


def test_method_is_case_insensitive():
    assert is_public_endpoint("get", "/api/health") is True


# --- must NOT be open --------------------------------------------------------

@pytest.mark.parametrize(
    "method, path",
    [
        ("POST", "/api/config"),                     # writes settings — GET only is public
        ("GET", "/api/vault/pages"),                 # the whole point of the exercise
        ("POST", "/api/vault/upload-property-file"),
        ("DELETE", "/api/vault/pages/some-id"),
        ("GET", "/api/vaults"),
        ("POST", "/api/public/tokens"),              # token MANAGEMENT is session-only…
        ("GET", "/api/tokens"),                      # …and lives outside /api/public/
        ("DELETE", "/api/share/abc123"),             # revoking a share is not anonymous
        ("POST", "/api/share"),
        ("GET", "/api/agent/run"),
    ],
)
def test_is_not_public(method: str, path: str):
    assert is_public_endpoint(method, path) is False


def test_health_prefix_does_not_leak_siblings():
    """A rule must not accidentally open a longer path that starts the same."""
    assert is_public_endpoint("GET", "/api/health/secrets") is False
    assert is_public_endpoint("GET", "/api/configuration") is False


def test_share_rule_is_single_segment():
    """`/api/share/{token}` must not open nested paths under a share."""
    assert is_public_endpoint("GET", "/api/share/tok/children") is False


@pytest.mark.parametrize("bad", ["", None])
def test_tolerates_missing_input(bad):
    assert is_public_endpoint(bad, "/api/health") is False
    assert is_public_endpoint("GET", bad) is False
