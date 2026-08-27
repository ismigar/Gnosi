"""Give a Gnosi account its email + password, locally.

This is the `set-password` flow the `User.password_hash` docstring refers to. It
exists for one situation: an install whose only user is the pre-auth legacy
account (`ismael-legacy`), which owns the workspace, the vaults and the API
tokens but has no way to log in. `/register` can only claim an account by
matching its email, and the legacy account's is the placeholder
`user@example.com`, so claiming through it would freeze a fake address in place.

It is a SCRIPT and not an HTTP endpoint on purpose. The obvious endpoint —
resolve the account from the request context, set a password on it — is an
account-takeover hole: `get_workspace_context` derives the user from the
`X-User-ID` header, which the caller controls, so anyone able to reach the API
could install their own password on `ismael-legacy` (a default published in this
repo) or on any invited user who has not registered yet. Requiring filesystem
access to the management DB removes the remote attack surface entirely.

The account keeps its `id`, which is what memberships, vaults and PATs are keyed
by, so nothing has to be migrated.

Usage:
    cd Gnosi
    GNOSI_DATA_DIR=/absolute/data .venv/bin/python pipeline/scripts/set_user_password.py --list
    GNOSI_DATA_DIR=/absolute/data .venv/bin/python pipeline/scripts/set_user_password.py \
        --user-id ismael-legacy --email you@example.com

The password is read interactively with `getpass`, never taken as an argument:
an argument would land in the shell history and in `ps` output.

ENABLE `GNOSI_REQUIRE_AUTH` BEFORE RUNNING THIS.
`_ensure_personal_exists` writes a fixed placeholder email for every
auto-provisioned user while `users.email` is UNIQUE, so today a request carrying
an unknown `X-User-ID` dies on an IntegrityError — the constraint blocks ghost
accounts by accident. Moving this account to a real address frees the
placeholder, and the next unknown header value then succeeds in creating a user
with `owner` membership on the shared personal workspace — but only while
enforcement is off. This script writes straight to the DB and does not need the
API, so turning the flag on FIRST closes that window entirely. The script prints
this warning and requires --i-understand.
"""
from __future__ import annotations

import argparse
import getpass
import sys
from pathlib import Path

# Allow running as a plain script from the app root (no package install).
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from sqlalchemy import func  # noqa: E402

from backend.data.management_db import get_mgmt_db  # noqa: E402
from backend.models.management import Membership, User  # noqa: E402
from backend.services.auth_service import (  # noqa: E402
    BCRYPT_MAX_PASSWORD_BYTES,
    PLACEHOLDER_EMAIL,
    hash_password,
    normalize_email,
)


def _describe(user: User, db) -> str:
    roles = db.query(Membership).filter(Membership.user_id == user.id).all()
    ws = ", ".join(f"{m.workspace_id}:{m.role}" for m in roles) or "no workspace"
    state = "with password" if user.password_hash else "WITHOUT password"
    return f"  {user.id:<24} {user.email:<32} {state:<18} [{ws}]"


def list_users(db) -> int:
    users = db.query(User).order_by(User.id).all()
    if not users:
        print("There are no users in the management database.")
        return 0
    print(f"{len(users)} user(s):")
    for u in users:
        print(_describe(u, db))
    return 0


def _read_password() -> str:
    """Prompt twice and return the password. Never echoes, never logs it."""
    pw = getpass.getpass("New password: ")
    if pw != getpass.getpass("Repeat the password: "):
        raise SystemExit("The passwords do not match. Nothing was changed.")
    if len(pw) < 8:
        raise SystemExit("The password must be at least 8 characters long.")
    # bcrypt's limit is on BYTES, so accented characters count double.
    n = len(pw.encode("utf-8"))
    if n > BCRYPT_MAX_PASSWORD_BYTES:
        raise SystemExit(
            f"The password uses {n} bytes, but bcrypt accepts at most "
            f"{BCRYPT_MAX_PASSWORD_BYTES} bytes (accented characters use multiple bytes)."
        )
    return pw


_MINTING_WARNING = """\
WARNING: migrating this account opens a security hole while the backend trusts X-User-Id.

This account currently owns the placeholder email, and the uniqueness constraint
accidentally prevents an unknown X-User-Id header from creating a new account.
Assigning a real email frees the placeholder, and the next request with an unknown
X-User-Id WILL create a user with the 'owner' role in the personal workspace.

Disable header-driven account minting first. See "Conditions that MUST be met" in
docs/dev_memory/directives/auth_remove_legacy_fallback.md.

SAFE ORDER (with no risk window):
  1. Set GNOSI_REQUIRE_AUTH=1 and restart the backend.
  2. Run this script (it writes directly to the database and does not need the API).
  3. Sign in with the new credentials.

Doing this in reverse leaves the placeholder free while enforcement is disabled,
which is exactly the combination that creates 'owner' accounts from a header.

If enforcement is already enabled, run this command again with --i-understand."""


def set_password(db, user_id: str, email: str | None, name: str | None, force: bool,
                 acknowledged: bool = False) -> int:
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        print(f"No user with id '{user_id}' exists. Use --list to view users.", file=sys.stderr)
        return 1

    if user.password_hash and not force:
        print(
            f"User '{user_id}' already has a password. Sign in normally, or run this "
            "command again with --force if you really want to replace it.",
            file=sys.stderr,
        )
        return 1

    if not acknowledged and normalize_email(user.email) == PLACEHOLDER_EMAIL:
        # Refuse by default: freeing the placeholder address is what enables
        # header-driven account minting (see the module docstring).
        print(_MINTING_WARNING, file=sys.stderr)
        return 1

    if not email and normalize_email(user.email) == PLACEHOLDER_EMAIL:
        # The whole reason this script takes an --email is that the legacy
        # account carries a placeholder address, identical on every install.
        # Setting a password without replacing it would leave that address as the
        # operator's permanent login identity — the outcome this exists to avoid.
        print(
            f"User '{user_id}' still has the placeholder email '{PLACEHOLDER_EMAIL}'. "
            "Run this command again with --email <your real email>.",
            file=sys.stderr,
        )
        return 1

    if email:
        normalized = normalize_email(email)
        # Case-insensitive: the DB unique index does not collapse case, so an
        # exact-match check would let `Other@x.com` coexist with `other@x.com`
        # and make login order-dependent.
        clash = (
            db.query(User)
            .filter(func.lower(User.email) == normalized, User.id != user.id)
            .first()
        )
        if clash:
            print(f"Email '{normalized}' is already assigned to user '{clash.id}'.", file=sys.stderr)
            return 1
        user.email = normalized

    if name:
        user.name = name

    user.password_hash = hash_password(_read_password())
    # This script is the one legitimate way an auto-provisioned account becomes a
    # deliberate one, so it is the one place that must clear the flag. Leaving it
    # set makes `users.auto_provisioned` assert "nobody invited this account"
    # about the operator's own credentials. Harmless only because the claim guard
    # checks `password_hash` first; any future guard that does not would lock the
    # operator out of the account that owns the workspace, the vaults and the PATs.
    user.auto_provisioned = False
    try:
        db.commit()
    except Exception as exc:  # noqa: BLE001 - surface the real cause to the operator
        db.rollback()
        print(f"Could not save the account: {exc}", file=sys.stderr)
        return 1

    print(f"Done. User '{user.id}' ({user.email}) can now sign in.")
    print("The id did not change, so the account retains its workspaces, vaults, and tokens.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--list", action="store_true", help="list users and their status")
    parser.add_argument("--user-id", help="id of the user whose password should be set")
    parser.add_argument("--email", help="real email address (replaces the placeholder)")
    parser.add_argument("--name", help="display name")
    parser.add_argument(
        "--i-understand",
        action="store_true",
        dest="acknowledged",
        help="confirm that you read the warning about X-User-Id account minting",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="replace an existing password (refused by default)",
    )
    args = parser.parse_args()

    db = next(get_mgmt_db())
    try:
        if args.list:
            return list_users(db)
        if not args.user_id:
            parser.error("--user-id is required (or use --list)")
        return set_password(db, args.user_id, args.email, args.name, args.force, args.acknowledged)
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
