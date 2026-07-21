"""The public-endpoint allowlist must be exact.

Two failure modes matter and they pull in opposite directions: too narrow and
the watchdogs start getting 401s and restart the backend in a loop; too wide and
removing the legacy fallback protects nothing. Both directions are asserted.
"""
import re

import pytest

from backend.services.auth_public_surface import (
    is_public_endpoint,
    public_surface_report,
)


# --- must stay open ----------------------------------------------------------

@pytest.mark.parametrize(
    "method, path",
    [
        ("GET", "/api/health"),          # docker_watchdog.sh + compose healthcheck
        ("POST", "/api/auth/login"),
        ("POST", "/api/auth/register"),
        ("POST", "/api/auth/logout"),
        ("GET", "/api/auth/me"),
        ("GET", "/api/share/abc123"),    # token in the URL is the credential
        ("POST", "/api/public/clip"),    # PAT-authenticated
        ("GET", "/api/public/clip/config"),  # the extension reads its form schema
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
        ("GET", "/api/config"),                      # admin-gated at the router
        ("POST", "/api/config"),                     # the whole router is admin-gated
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


# --- the end anchor must be absolute ----------------------------------------

@pytest.mark.parametrize(
    "path",
    ["/api/health\n", "/api/health\n/evil", "/api/auth/login\n"],
)
def test_a_trailing_newline_does_not_slip_through(path: str):
    """`$` also matches before a trailing newline; an allowlist needs `\\Z`.

    Otherwise a path carrying a newline would be exempted from authentication.
    """
    assert is_public_endpoint("GET", path) is False
    assert is_public_endpoint("POST", path) is False


# --- the allowlist must not drift away from the real routes ------------------

def test_every_rule_matches_a_real_route():
    """A rule that matches nothing is dead weight that reads as coverage.

    Nothing consults `is_public_endpoint` yet (enforcement is phase 4), so
    without this the list could name a route that has moved or never existed and
    the mistake would only surface as a surprise 401 later.
    """
    from backend.server import app

    # Read the routes from the OpenAPI schema rather than walking `app.routes`:
    # this FastAPI version keeps included routers as opaque `_IncludedRouter`
    # objects there, so the real paths are not directly enumerable.
    real = {
        (method.upper(), path)
        for path, ops in app.openapi()["paths"].items()
        for method in ops
    }
    assert real, "could not enumerate any route — the check would pass vacuously"

    unmatched = []
    for methods, pattern, _reason in public_surface_report():
        for method in methods.split(","):
            # Fill path params with a placeholder so a template like
            # "/api/share/{token}" can be tested against the rule's regex.
            hit = any(
                m == method and is_public_endpoint(m, re.sub(r"\{[^}]+\}", "x", p))
                for (m, p) in real
            )
            if not hit:
                unmatched.append(f"{method} {pattern}")
    assert not unmatched, f"allowlist rules matching no real route: {unmatched}"
