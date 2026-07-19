"""The `/register` claim flow must refuse accounts nobody invited.

Claiming by email is a weak proof of identity: it only holds when an admin
deliberately chose the address. Three code paths mint password-less accounts
with addresses that are hardcoded or derived from a request header, and this
repo is public — so knowing one proves nothing, and the account they create owns
the workspace, the vaults and the API tokens.

The guard used to compare against one magic string and missed two of the three.
It now reads `users.auto_provisioned`, recorded at mint time, with the address
heuristic kept as a second line. These tests pin both, so a fourth minting path
that forgets the column is caught by whichever line still applies — and a real
invitee is never locked out of their own account.
"""
from __future__ import annotations

import pytest

from backend.services.auth_service import (
    is_auto_provisioned_account,
    is_auto_provisioned_email,
)


class _FakeUser:
    """Stand-in for the ORM row: the guard only reads two attributes."""

    def __init__(self, email: str, auto_provisioned: bool = False):
        self.email = email
        self.auto_provisioned = auto_provisioned


# The three minting paths named in the auth directive, by the address each one
# invents. If a fourth appears, it belongs here.
MINTED_ADDRESSES = [
    pytest.param("user@example.com", id="ensure_personal_exists"),
    pytest.param("ghost-attacker@example.com", id="post_api_workspaces"),
    pytest.param("ismael-legacy@gnosi.app", id="init_management"),
]


@pytest.mark.parametrize("email", MINTED_ADDRESSES)
def test_the_address_heuristic_still_covers_every_known_path(email):
    """The second line must keep working on rows that predate the column."""
    assert is_auto_provisioned_email(email) is True
    assert is_auto_provisioned_account(_FakeUser(email)) is True


@pytest.mark.parametrize("email", MINTED_ADDRESSES)
def test_the_column_is_what_actually_decides(email):
    assert is_auto_provisioned_account(_FakeUser(email, auto_provisioned=True)) is True


def test_the_column_catches_an_address_the_heuristic_does_not_know():
    """The point of the column: a future minting path picking any domain.

    This is the case the string matching could never cover — it is why the
    directive asked for the property to be recorded rather than inferred.
    """
    invented = _FakeUser("someone@a-domain-nobody-listed.test", auto_provisioned=True)
    assert is_auto_provisioned_email(invented.email) is False, "precondition"
    assert is_auto_provisioned_account(invented) is True


@pytest.mark.parametrize(
    "email",
    [
        "ismael@correu-real.cat",
        # gnosi.app is deliberately NOT blocked as a whole domain: a deployment
        # may host its people there and they must be able to claim their account.
        "algu@gnosi.app",
    ],
)
def test_a_real_invitee_is_never_refused(email):
    assert is_auto_provisioned_email(email) is False
    assert is_auto_provisioned_account(_FakeUser(email)) is False


@pytest.mark.parametrize("email", ["USER@EXAMPLE.COM", "  user@example.com  "])
def test_matching_survives_case_and_padding(email):
    assert is_auto_provisioned_email(email) is True


@pytest.mark.parametrize("email", ["", "   ", "no-arroba", "@example.com"])
def test_malformed_addresses_do_not_crash_the_guard(email):
    assert is_auto_provisioned_email(email) in (True, False)


def test_a_row_without_the_attribute_falls_back_to_the_address():
    """A row from a pre-column DB has no attribute at all — must not crash."""

    class _Legacy:
        email = "user@example.com"

    assert is_auto_provisioned_account(_Legacy()) is True
