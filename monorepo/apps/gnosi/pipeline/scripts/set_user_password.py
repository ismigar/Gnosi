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
    cd monorepo/apps/gnosi
    GNOSI_LOCAL_DATA=local_data .venv/bin/python pipeline/scripts/set_user_password.py --list
    GNOSI_LOCAL_DATA=local_data .venv/bin/python pipeline/scripts/set_user_password.py \
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
    ws = ", ".join(f"{m.workspace_id}:{m.role}" for m in roles) or "cap workspace"
    state = "amb contrasenya" if user.password_hash else "SENSE contrasenya"
    return f"  {user.id:<24} {user.email:<32} {state:<18} [{ws}]"


def list_users(db) -> int:
    users = db.query(User).order_by(User.id).all()
    if not users:
        print("No hi ha cap usuari a la base de dades de gestió.")
        return 0
    print(f"{len(users)} usuari(s):")
    for u in users:
        print(_describe(u, db))
    return 0


def _read_password() -> str:
    """Prompt twice and return the password. Never echoes, never logs it."""
    pw = getpass.getpass("Nova contrasenya: ")
    if pw != getpass.getpass("Repeteix la contrasenya: "):
        raise SystemExit("Les contrasenyes no coincideixen. No s'ha canviat res.")
    if len(pw) < 8:
        raise SystemExit("La contrasenya ha de tenir com a mínim 8 caràcters.")
    # bcrypt's limit is on BYTES, so accented characters count double.
    n = len(pw.encode("utf-8"))
    if n > BCRYPT_MAX_PASSWORD_BYTES:
        raise SystemExit(
            f"La contrasenya ocupa {n} bytes i bcrypt n'accepta {BCRYPT_MAX_PASSWORD_BYTES} "
            "com a màxim (els caràcters accentuats compten doble)."
        )
    return pw


_MINTING_WARNING = """\
ATENCIÓ: migrar aquest compte OBRE un forat mentre el backend confiï en X-User-Id.

Ara mateix l'email marcador està ocupat per aquest compte i la restricció d'unicitat
impedeix, per accident, que una capçalera X-User-Id desconeguda creï un compte nou.
En donar-li un email real, el marcador queda lliure i la següent petició amb un
X-User-Id desconegut SÍ crearà un usuari amb rol 'owner' del workspace personal.

Tanca primer el minting per capçalera. Vegeu la secció "Conditions that MUST be met"
a docs/dev_memory/directives/auth_remove_legacy_fallback.md.

ORDRE SEGUR (sense finestra de risc):
  1. GNOSI_REQUIRE_AUTH=1 i reinicia el backend.
  2. Executa aquest script (escriu directament a la BD; no li cal l'API).
  3. Inicia sessió amb les credencials noves.

Fer-ho al revés deixa una finestra amb el marcador lliure i l'enforcement apagat,
que és justament la combinació que crea comptes 'owner' des d'una capçalera.

Si ja tens l'enforcement actiu, torna-ho a executar amb --i-understand."""


def set_password(db, user_id: str, email: str | None, name: str | None, force: bool,
                 acknowledged: bool = False) -> int:
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        print(f"No existeix cap usuari amb id '{user_id}'. Usa --list per veure'ls.", file=sys.stderr)
        return 1

    if user.password_hash and not force:
        print(
            f"L'usuari '{user_id}' ja té contrasenya. Fes login normalment, o torna-ho a "
            "executar amb --force si realment la vols substituir.",
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
            f"L'usuari '{user_id}' encara té l'email marcador '{PLACEHOLDER_EMAIL}'. "
            "Torna-ho a executar amb --email <el teu email real>.",
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
            print(f"L'email '{normalized}' ja el té l'usuari '{clash.id}'.", file=sys.stderr)
            return 1
        user.email = normalized

    if name:
        user.name = name

    user.password_hash = hash_password(_read_password())
    try:
        db.commit()
    except Exception as exc:  # noqa: BLE001 - surface the real cause to the operator
        db.rollback()
        print(f"No s'ha pogut desar: {exc}", file=sys.stderr)
        return 1

    print(f"Fet. L'usuari '{user.id}' ({user.email}) ja pot iniciar sessió.")
    print("L'id no ha canviat, així que conserva workspaces, vaults i tokens.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--list", action="store_true", help="llista els usuaris i el seu estat")
    parser.add_argument("--user-id", help="id de l'usuari a qui posar la contrasenya")
    parser.add_argument("--email", help="email real (substitueix el marcador)")
    parser.add_argument("--name", help="nom a mostrar")
    parser.add_argument(
        "--i-understand",
        action="store_true",
        dest="acknowledged",
        help="confirma que has llegit l'avís sobre el minting per X-User-Id",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="substitueix una contrasenya existent (per defecte es refusa)",
    )
    args = parser.parse_args()

    db = next(get_mgmt_db())
    try:
        if args.list:
            return list_users(db)
        if not args.user_id:
            parser.error("cal --user-id (o --list)")
        return set_password(db, args.user_id, args.email, args.name, args.force, args.acknowledged)
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
