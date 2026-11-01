#!/usr/bin/env python3
"""Serve the production backend with an owned, persistent synthetic fixture.

Nothing from ``backend`` may be imported before ``prepare_runtime`` and the
process guard. The supplied directory is disposable, but is never deleted or
reseeded on restart. The state manifest contains synthetic login credentials.
"""

from __future__ import annotations

import argparse
import asyncio
from contextlib import asynccontextmanager
from dataclasses import dataclass
import hashlib
import importlib
import json
import logging
import os
from pathlib import Path
import re
import secrets
import sys
from typing import Any, MutableMapping, Sequence
import uuid
from urllib.parse import unquote, urlsplit


SOURCE_ROOT = Path(__file__).resolve().parents[2]
LOG = logging.getLogger(__name__)
OWNER_FILE = ".gnosi-acceptance-owner.json"
SCHEMA_VERSION = 1
PASSWORD = "Synthetic-acceptance-only-2026!"
_NAMESPACE = uuid.UUID("9cc80377-9ac8-45d3-99be-e87f1e9ead39")


def fixture_id(name: str) -> str:
    """Return a stable synthetic identity without consulting user storage."""
    return str(uuid.uuid5(_NAMESPACE, name))


def _owned_path(root: Path, candidate: Path) -> Path:
    if not candidate.is_absolute() or ".." in candidate.parts:
        raise ValueError("Acceptance paths must be absolute and contained in the owned root")
    resolved = candidate.resolve()
    if resolved != candidate or not resolved.is_relative_to(root):
        raise ValueError("Acceptance paths must not escape the owned root or traverse symlinks")
    return candidate


def _write_json(path: Path, value: dict[str, Any]) -> None:
    temporary = path.with_name(f".{path.name}.tmp")
    with temporary.open("w", encoding="utf-8") as stream:
        json.dump(value, stream, indent=2, ensure_ascii=False)
        stream.write("\n")
    temporary.chmod(0o600)
    temporary.replace(path)


def _credentials(environ: MutableMapping[str, str], kind: str) -> dict[str, str]:
    # EmailStr rejects .invalid, even with delivery checks disabled. example.org
    # is reserved documentation space and passes the unchanged production model.
    email = environ.get(f"GNOSI_ACCEPTANCE_{kind.upper()}_EMAIL", f"{kind}@acceptance.example.org")
    if not re.fullmatch(r"[A-Za-z0-9_.+-]+@acceptance\.example\.org", email):
        raise ValueError("Acceptance accounts must use the synthetic acceptance.example.org domain")
    password = environ.get("GNOSI_ACCEPTANCE_PASSWORD", PASSWORD)
    if not 8 <= len(password.encode("utf-8")) <= 72:
        raise ValueError("Acceptance passwords must contain between 8 and 72 UTF-8 bytes")
    return {"id": fixture_id(kind), "email": email.lower(), "password": password,
            "name": f"Acceptance {kind.title()}"}


def _fixture_state(root: Path, port: int, accounts: dict[str, Any], mode: str) -> dict[str, Any]:
    rows = [
        {"id": fixture_id("row-one"), "title": "Acceptance first record",
         "content": "A synthetic first record with a searchable amber lighthouse.\n"},
        {"id": fixture_id("row-two"), "title": "Acceptance second record",
         "content": "A synthetic second record with a searchable violet observatory.\n"},
    ]
    table_id = fixture_id("table")
    workspace_id = "personal" if mode == "personal" else fixture_id("workspace")
    return {
        "schema_version": SCHEMA_VERSION, "root": str(root), "source_root": str(SOURCE_ROOT),
        "backend_url": f"http://127.0.0.1:{port}", **accounts,
        "mode": mode, "workspace_id": workspace_id,
        "workspace": {"id": workspace_id, "name": "Acceptance workspace"},
        "vaults": {
            "primary": {"id": fixture_id("primary-vault"), "name": "Acceptance primary",
                        "slug": "acceptance-primary", "path": str(root / "vault")},
            "secondary": {"id": fixture_id("secondary-vault"), "name": "Acceptance secondary",
                          "slug": "acceptance-secondary", "path": str(root / "vault-secondary")},
        },
        "database": {"id": fixture_id("database"), "name": "Acceptance database"},
        "table_id": table_id, "view_id": fixture_id("main-view"),
        "table": {"id": table_id, "name": "Acceptance records", "folder": "Acceptance records",
                  "view_id": fixture_id("main-view")},
        "rows": rows, "page_ids": [row["id"] for row in rows],
        "secondary_page": {"id": fixture_id("secondary-note"), "title": "Secondary vault note",
                           "content": "This synthetic note belongs only to the secondary vault.\n"},
    }


@dataclass(frozen=True)
class AcceptanceRuntime:
    root: Path
    state_path: Path
    port: int
    frontend_port: int | None
    state: dict[str, Any]
    first_boot: bool


def prepare_runtime(root: Path, port: int, state_path: Path, *,
                    frontend_port: int | None = None,
                    mode: str = "organization",
                    environ: MutableMapping[str, str] | None = None) -> AcceptanceRuntime:
    """Validate ownership and configure isolation before importing the backend.

    A first boot accepts an empty directory or the empty data/vault/host and
    cache/log directories prepared by the acceptance launcher. Later boots
    require this script's source-bound ownership receipt and existing manifest.
    HOME is intentionally retained verbatim.
    """
    env = os.environ if environ is None else environ
    if mode not in {"organization", "personal"}:
        raise ValueError("Acceptance requires an explicit supported application mode")
    if not 1 <= port <= 65535 or (frontend_port is not None and
            (not 1 <= frontend_port <= 65535 or frontend_port == port)):
        raise ValueError("Supply distinct, explicit backend/frontend TCP ports")
    if not root.is_absolute() or not root.is_dir() or root == root.parent:
        raise ValueError("Supply an existing absolute disposable acceptance directory")
    # macOS /tmp is a system symlink; callers must pass its resolved spelling.
    if root.resolve() != root or ".." in root.parts:
        raise ValueError("The acceptance root must be canonical and must not traverse symlinks")
    if root == SOURCE_ROOT or root in SOURCE_ROOT.parents or root == Path.home():
        raise ValueError("A source checkout, home directory or ancestor cannot own acceptance data")
    state_path = _owned_path(root, state_path)
    if state_path == root or state_path.name == OWNER_FILE:
        raise ValueError("Supply a distinct state manifest file beneath the acceptance root")
    selectors = {
        "GNOSI_VALIDATION_ROOT": root, "GNOSI_DATA_DIR": root / "data",
        "DIGITAL_BRAIN_VAULT_PATH": root / "vault", "VAULT_HOST_PATH": root / "vault",
        "HOME_HOST_PATH": root / "host", "GNOSI_VAULTS_ROOT": root,
        "GNOSI_LOCAL_DATA": root / "data", "LOCAL_DATA_DIR": root / "data",
    }
    for name, expected in selectors.items():
        if env.get(name) and _owned_path(root, Path(env[name])) != expected:
            raise ValueError(f"Acceptance refuses a non-owned selector: {name}")
    if env.get("GNOSI_SHARED_ENV_FILE"):
        _owned_path(root, Path(env["GNOSI_SHARED_ENV_FILE"]))
    receipt_path = _owned_path(root, root / OWNER_FILE)
    if receipt_path.exists():
        receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
        if (receipt.get("schema_version") != SCHEMA_VERSION or receipt.get("root") != str(root)
                or receipt.get("source_root") != str(SOURCE_ROOT)
                or receipt.get("state_path") != str(state_path) or receipt.get("mode") != mode):
            raise ValueError("Acceptance ownership receipt does not match this source/root/state")
        if not isinstance(receipt.get("jwt_secret"), str) or len(receipt["jwt_secret"]) < 32:
            raise ValueError("Acceptance ownership receipt has no signing secret")
        if not state_path.is_file():
            raise ValueError("An incomplete fixture cannot be silently reseeded; use a fresh root")
        state = json.loads(state_path.read_text(encoding="utf-8"))
        for key, expected in (("root", str(root)), ("source_root", str(SOURCE_ROOT)),
                              ("schema_version", SCHEMA_VERSION)):
            if state.get(key) != expected:
                raise ValueError("Acceptance state does not match its ownership receipt")
        first_boot = False
    else:
        allowed = {"data", "vault", "vault-secondary", "host", "cache", "logs"}
        if any(child.name not in allowed or child.is_symlink() or not child.is_dir()
               for child in root.iterdir()):
            raise ValueError("First boot requires an empty or launcher-prepared disposable root")
        for name in ("data", "vault", "vault-secondary", "host"):
            path = root / name
            if path.exists() and any(path.iterdir()):
                raise ValueError("Acceptance refuses pre-existing application data")
        accounts = {kind: _credentials(env, kind) for kind in ("owner", "viewer")}
        if accounts["owner"]["email"] == accounts["viewer"]["email"]:
            raise ValueError("Owner and viewer must have distinct synthetic identities")
        state = _fixture_state(root, port, accounts, mode)
        receipt = {"schema_version": SCHEMA_VERSION, "root": str(root),
                   "source_root": str(SOURCE_ROOT), "state_path": str(state_path),
                   "jwt_secret": secrets.token_urlsafe(48), "mode": mode}
        first_boot = True
    # Reject nested links too: an owned receipt never authorizes storage escapes.
    if any(path.is_symlink() for path in root.rglob("*")):
        raise ValueError("Acceptance storage must not contain symbolic links")
    for name in ("data", "vault", "vault-secondary", "host", "cache", "cache/tmp"):
        _owned_path(root, root / name).mkdir(parents=True, exist_ok=True)
    state_path.parent.mkdir(parents=True, exist_ok=True)
    if first_boot:
        _write_json(receipt_path, receipt)
        for vault in state["vaults"].values():
            configuration = Path(vault["path"]) / ".gnosi"
            configuration.mkdir()
            (configuration / "params.yaml").write_text(
                f"settings:\n  language: en\n  gnosi_mode: {mode}\n"
                "ai:\n  providers: {}\n  models: []\n  agents: []\n", encoding="utf-8",
            )
            _write_json(configuration / "plugins.json", {
                "schema_version": 2, "enabled_builtin": [
                    "resources", "page-comments", "share-links", "ai-platform", "automations",
                    "calendar", "contacts", "feeds-reader", "grounded-notebooks", "mail",
                    "project-planning", "social-publishing", "web-publishing",
                ],
                "enabled_third_party": [], "settings": {}, "granted": {},
            })
    # Do not retain provider credentials, native discovery or inherited service URLs.
    for name in list(env):
        if (re.search(r"TOKEN|SECRET|PASSWORD|CREDENTIAL|API_KEY|PRIVATE_KEY|AUTH", name, re.I)
                or name.startswith(("GNOSI_", "DIGITAL_BRAIN_", "VAULT_", "HOME_HOST_", "LOCAL_DATA_"))
                or name in {"HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy",
                            "all_proxy", "OLLAMA_BASE_URL", "THUMB_DAEMON_URL", "PYTHONPATH"}):
            env.pop(name, None)
    env.update({name: str(path) for name, path in selectors.items()})
    env.update({
        "GNOSI_MODE": mode, "GNOSI_REQUIRE_AUTH": "1",
        "GNOSI_JWT_SECRET": receipt["jwt_secret"], "GNOSI_DISABLE_SCHEDULER": "1",
        "GNOSI_FILES_PROVIDER": "local", "GNOSI_RUN_LIVE_E2E": "0",
        "GNOSI_SHARED_ENV_FILE": str(root / "disabled.env"),
        "GNOSI_BACKEND_URL": f"http://127.0.0.1:{port}",
        "GNOSI_BASE_URL": f"http://127.0.0.1:{frontend_port or port}",
        "GNOSI_DESKTOP_VAULT_DISCOVERY": "0", "NO_PROXY": "127.0.0.1,localhost,::1",
        "PYTHONDONTWRITEBYTECODE": "1", "TMPDIR": str(root / "cache/tmp"),
    })
    state["backend_url"] = f"http://127.0.0.1:{port}"
    return AcceptanceRuntime(root, state_path, port, frontend_port, state, first_boot)


def install_process_guard(runtime: AcceptanceRuntime) -> None:
    """Refuse outside writes, credential files, child processes and unowned sockets.

    This is process-local acceptance infrastructure. It leaves application
    routes, dependencies, middleware and authentication intact.
    """
    ports = {runtime.port, runtime.frontend_port} - {None}

    def check_address(address: object, *, binding: bool = False) -> None:
        if (not isinstance(address, tuple) or len(address) < 2
                or address[0] not in {"127.0.0.1", "::1", "localhost"}
                or address[1] not in ({runtime.port} if binding else ports)):
            raise PermissionError("Acceptance refused an unowned socket address")

    def check_path(value: object) -> Path | None:
        if isinstance(value, int) or value is None:
            return None
        path = Path(os.fsdecode(value)).absolute()
        return path.resolve()

    def require_owned(value: object) -> None:
        path = check_path(value)
        if path is not None and not path.is_relative_to(runtime.root):
            raise PermissionError("Acceptance refused a write outside its owned root")

    def audit(event: str, args: tuple[Any, ...]) -> None:
        if event in {"socket.connect", "socket.sendto", "socket.bind"}:
            check_address(args[-1], binding=event == "socket.bind")
        elif event in {"socket.getaddrinfo", "socket.gethostbyname", "socket.gethostbyaddr"}:
            host = os.fsdecode(args[0]) if isinstance(args[0], bytes) else args[0]
            if host not in {"127.0.0.1", "::1", "localhost"}:
                raise PermissionError("Acceptance refused external name resolution")
            if event == "socket.getaddrinfo" and args[1] not in ports:
                raise PermissionError("Acceptance refused an unowned service port")
        elif event in {"subprocess.Popen", "os.system", "os.exec", "os.posix_spawn", "pty.spawn"}:
            raise PermissionError("Acceptance does not launch provider or credential helper processes")
        elif event == "open":
            path = check_path(args[0])
            if path is None:
                return
            if (path.name == ".env" or path.name.startswith(".env.")
                    or (not path.is_relative_to(runtime.root) and
                        (".gnosi" in path.parts or "private_skills" in path.parts))):
                raise PermissionError("Acceptance refused a non-fixture credential/configuration file")
            flags = args[2] or 0
            if flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC | os.O_APPEND):
                require_owned(args[0])
        elif event == "sqlite3.connect" and args[0] != ":memory:":
            database = os.fsdecode(args[0])
            if database.startswith("file:"):
                uri = urlsplit(database)
                if uri.netloc not in {"", "localhost"}:
                    raise PermissionError("Acceptance refused a nonlocal SQLite URI")
                database = unquote(uri.path)
            require_owned(database)
        elif event in {"os.mkdir", "os.remove", "os.rmdir", "os.truncate", "os.chmod", "os.utime"}:
            require_owned(args[0])
        elif event in {"os.rename", "os.link", "os.symlink"}:
            require_owned(args[0])
            require_owned(args[1])
            if event in {"os.link", "os.symlink"}:
                raise PermissionError("Acceptance storage does not create links")

    sys.addaudithook(audit)


def verify_source_imports() -> dict[str, str]:
    """Prove every imported backend module belongs to this checkout."""
    evidence: dict[str, str] = {}
    for name, module in tuple(sys.modules.items()):
        if name != "backend" and not name.startswith("backend."):
            continue
        source = getattr(module, "__file__", None)
        if source is not None and not Path(source).resolve().is_relative_to(SOURCE_ROOT / "backend"):
            raise RuntimeError("Acceptance imported a backend module from a different checkout")
        if name in {"backend.server", "backend.app.factory", "backend.app.lifespan"}:
            evidence[name] = str(Path(source).resolve())
    if len(evidence) != 3:
        raise RuntimeError("Acceptance production entrypoint/lifespan provenance is incomplete")
    return evidence


def _seed_management(runtime: AcceptanceRuntime) -> None:
    from backend.data.management_db import get_mgmt_session
    from backend.models.management import Membership, User, Vault, Workspace
    from backend.services.auth_service import hash_password

    state = runtime.state
    with get_mgmt_session() as db:
        if db.query(User).count() or db.query(Workspace).count() or db.query(Vault).count():
            raise RuntimeError("First boot refuses a populated management database")
        db.add(Workspace(id=state["workspace_id"], name=state["workspace"]["name"],
                         slug="acceptance-workspace"))
        for kind in ("owner", "viewer"):
            account = state[kind]
            db.add(User(id=account["id"], email=account["email"], name=account["name"],
                        password_hash=hash_password(account["password"]), auto_provisioned=False))
        db.flush()
        for kind in ("owner", "viewer"):
            db.add(Membership(user_id=state[kind]["id"], workspace_id=state["workspace_id"],
                              role=kind, permissions=json.dumps({"capabilities":
                                  ["read", "write", "delete", "admin"] if kind == "owner" else ["read"]})))
        for vault in state["vaults"].values():
            db.add(Vault(id=vault["id"], workspace_id=state["workspace_id"], name=vault["name"],
                         slug=vault["slug"], path_override=vault["path"]))
        db.commit()


def verify_registered_storage(runtime: AcceptanceRuntime) -> None:
    """Reject persisted vault selectors before startup can warm their indexes."""
    from backend.data.management_db import get_mgmt_session
    from backend.models.management import Vault

    with get_mgmt_session() as db:
        for vault in db.query(Vault).all():
            if not vault.path_override:
                raise RuntimeError("Acceptance refuses a vault without an explicit owned path")
            _owned_path(runtime.root, Path(vault.path_override))


async def seed_or_verify_fixture(app: Any, runtime: AcceptanceRuntime) -> None:
    """Seed once using production routes and real login cookies; restart only reads."""
    import httpx

    state = runtime.state
    if runtime.first_boot:
        _seed_management(runtime)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url=state["backend_url"]) as client:
        async def request(method: str, path: str, **kwargs: Any) -> Any:
            response = await client.request(method, path, **kwargs)
            if response.status_code >= 400:
                raise RuntimeError(f"Synthetic fixture {method} {path} failed ({response.status_code})")
            return response.json()

        for kind in ("viewer", "owner"):
            account = state[kind]
            logged_in = await request("POST", "/api/auth/login", json={
                "email": account["email"], "password": account["password"],
            })
            if logged_in["id"] != account["id"]:
                raise RuntimeError("Synthetic login resolved an unexpected identity")
        headers = {"X-Workspace-Id": state["workspace_id"],
                   "X-Vault-Id": state["vaults"]["primary"]["id"]}
        client.headers.update(headers)
        if runtime.first_boot:
            await request("POST", "/api/vault/databases", json=state["database"])
            # The ordinary view API accepts a supplied ID. Creating it first
            # lets table creation adopt one deterministic canonical main view.
            await request("POST", "/api/vault/views", json={
                "id": state["view_id"], "table_id": state["table_id"], "type": "table",
                "is_main": True, "name": state["table"]["name"],
            })
            await request("POST", "/api/vault/tables", json={
                **{key: value for key, value in state["table"].items() if key != "view_id"},
                "database_id": state["database"]["id"], "locale": "en",
                "properties": [
                    {"id": fixture_id("title-property"), "name": "Name", "type": "title"},
                    {"id": fixture_id("status-property"), "name": "Status", "type": "select",
                     "options": ["Planned", "Done"]},
                ],
            })
            for row in state["rows"]:
                await request("PUT", f"/api/vault/pages/{row['id']}", json={
                    "title": row["title"], "content": row["content"],
                    "metadata": {"table_id": state["table_id"], "Name": row["title"], "Status": "Planned"},
                })
            client.headers["X-Vault-Id"] = state["vaults"]["secondary"]["id"]
            page = state["secondary_page"]
            await request("PUT", f"/api/vault/pages/{page['id']}", json={
                "title": page["title"], "content": page["content"], "metadata": {},
            })
            client.headers["X-Vault-Id"] = state["vaults"]["primary"]["id"]
            views = await request("GET", f"/api/vault/views?table_id={state['table_id']}")
            if next(view["id"] for view in views if view.get("is_main")) != state["view_id"]:
                raise RuntimeError("Synthetic table did not adopt its deterministic main view")
        # A restart never POSTs/PUTs table or page data, even when verification fails.
        for row in state["rows"]:
            document = await request("GET", f"/api/vault/pages/{row['id']}")
            if document["id"] != row["id"]:
                raise RuntimeError("A synthetic fixture page is missing after startup")
            if runtime.first_boot and document["content"].strip() != row["content"].strip():
                raise RuntimeError("The fixture row body was not persisted by the production API")
        if runtime.first_boot:
            snapshot = await request("GET", f"/api/vault/pages/by-table/{state['table_id']}/snapshot")
            if {page["id"] for page in snapshot["pages"]} != set(state["page_ids"]):
                raise RuntimeError("The fixture table does not expose its two real row documents")
        vaults = await request("GET", "/api/vaults")
        actual = {vault["id"]: vault for vault in vaults["vaults"]}
        for vault in state["vaults"].values():
            if vault["id"] not in actual or actual[vault["id"]]["path"] != vault["path"]:
                raise RuntimeError("A registered fixture vault escaped its owned storage")
    state["source_files"] = verify_source_imports()
    state["fixture_script_sha256"] = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    _write_json(runtime.state_path, state)


def create_application(runtime: AcceptanceRuntime) -> Any:
    """Keep the shipped server and full lifespan, adding fixture setup before readiness."""
    sys.path.insert(0, str(SOURCE_ROOT))
    from backend.config.validation_runtime import validation_runtime_enabled

    if not validation_runtime_enabled():
        raise RuntimeError("Acceptance cannot import the backend without isolated validation")
    server = importlib.import_module("backend.server")
    verify_source_imports()
    production_lifespan = server.lifespan

    @asynccontextmanager
    async def acceptance_lifespan(app: Any):
        verify_registered_storage(runtime)
        async with production_lifespan(app):
            await seed_or_verify_fixture(app, runtime)
            yield

    server.app.router.lifespan_context = acceptance_lifespan
    return server.app


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--state", type=Path, required=True)
    parser.add_argument("--frontend-port", type=int)
    parser.add_argument("--mode", choices=("organization", "personal"), default="organization")
    parser.add_argument("--seed-only", action="store_true", help="Run the real lifespan/fixture, then exit")
    args = parser.parse_args(argv)
    try:
        if any(name == "backend" or name.startswith("backend.") for name in sys.modules):
            raise RuntimeError("Acceptance must configure isolation before any backend import")
        runtime = prepare_runtime(args.root, args.port, args.state, frontend_port=args.frontend_port, mode=args.mode)
        install_process_guard(runtime)
        app = create_application(runtime)
        if args.seed_only:
            async def initialize() -> None:
                async with app.router.lifespan_context(app):
                    pass
            asyncio.run(initialize())
        else:
            import uvicorn

            # Force Python sockets so the process audit hook also covers async I/O.
            uvicorn.run(app, host="127.0.0.1", port=runtime.port, workers=1, reload=False,
                        loop="asyncio", http="h11", access_log=False)
        return 0
    except (ValueError, RuntimeError, PermissionError, OSError) as error:
        LOG.error("Acceptance backend failed: %s", error)
        return 2


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    raise SystemExit(main())
