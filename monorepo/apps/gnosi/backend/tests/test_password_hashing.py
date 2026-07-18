"""Password hashing must actually work, and fail loudly when it cannot.

Regression for a dependency break that made the whole auth system unusable:
passlib 1.7.4 (its last release) detects its bcrypt backend by reading
`bcrypt.__about__.__version__`, an attribute removed in bcrypt 4.1. With a
modern bcrypt the detection raised and passlib then rejected EVERY password as
"longer than 72 bytes" — a 10-character one included. `/register` and `/login`
could not work at all, and because `verify_password` swallows exceptions as
"does not match", it surfaced as wrong credentials rather than a broken
dependency. Hence the explicit round-trip assertions here.
"""
import pytest

from backend.services.auth_service import (
    BCRYPT_MAX_PASSWORD_BYTES,
    hash_password,
    verify_password,
)


@pytest.mark.parametrize(
    "password",
    [
        "shortish1",                       # ~9 ASCII chars — used to fail
        "una-contrasenya-perfectament-normal",
        "contrasenya-amb-accents-àèíòú",   # multi-byte UTF-8
        "🔐🔐🔐 emoji password",            # 4-byte code points
        "x" * BCRYPT_MAX_PASSWORD_BYTES,   # exactly at the limit
    ],
)
def test_hash_and_verify_round_trip(password: str):
    hashed = hash_password(password)
    assert hashed.startswith("$2b$"), "expected a bcrypt hash"
    assert verify_password(password, hashed) is True


def test_wrong_password_does_not_verify():
    hashed = hash_password("the-right-one")
    assert verify_password("the-wrong-one", hashed) is False


def test_hashes_are_salted():
    """Two hashes of the same password must differ, and both must verify."""
    a, b = hash_password("same-password"), hash_password("same-password")
    assert a != b
    assert verify_password("same-password", a)
    assert verify_password("same-password", b)


# --- the 72-byte limit is real; it must be explicit, never silent ------------

def test_over_long_password_is_rejected_not_truncated():
    """Truncating would let a different password open the same account."""
    too_long = "x" * (BCRYPT_MAX_PASSWORD_BYTES + 1)
    with pytest.raises(ValueError):
        hash_password(too_long)


def test_accented_password_counts_bytes_not_characters():
    """'à' is 2 bytes: 40 such characters exceed the limit despite being < 72 chars."""
    accented = "à" * 40
    assert len(accented) < BCRYPT_MAX_PASSWORD_BYTES
    assert len(accented.encode("utf-8")) > BCRYPT_MAX_PASSWORD_BYTES
    with pytest.raises(ValueError):
        hash_password(accented)


def test_empty_password_is_rejected():
    with pytest.raises(ValueError):
        hash_password("")


@pytest.mark.parametrize("hashed", ["", "not-a-hash", "$2b$12$truncated"])
def test_verify_never_raises_on_malformed_hash(hashed: str):
    assert verify_password("whatever", hashed) is False
