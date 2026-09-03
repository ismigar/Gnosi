"""Reviewed first-party resources for the frozen backend (no application imports).

Contract: ``build_plan(root)`` returns individual PyInstaller data files and
module names; ``validate_analysis`` checks its TOCs before COLLECT;
``verify_bundle(root, plan)`` checks the resulting onedir before smoke/packaging.
The CLI exposes ``spec``, ``check-source`` and ``verify`` (see --help).

Data additions require review here. Never filter an unexpected file out of a
selected resource directory or a built bundle: raise ResourcePolicyError.
Unselected source locations (user config, vaults, generated tools, databases)
are not resources and are never opened. Third-party binaries are not scanned
as text; this policy is not a general-purpose secret scanner or installer test.
"""

from __future__ import annotations

import argparse
import hashlib
import logging
import posixpath
import re
import stat
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

LOG = logging.getLogger(__name__)
TocEntry = tuple[str, str, str]

# Source-only discovery avoids collect_submodules('backend'), which imports the
# application and can initialize real configuration, databases and automation.
MODULE_TREES = (
    "backend/agent",
    "backend/api",
    "backend/app",
    "backend/config",
    "backend/domains",
    "backend/mcp",
    "backend/models",
    "backend/platform",
    "backend/scheduler",
    "backend/security",
    "backend/services",
    "backend/sync",
    "backend/utils",
    "pipeline/skills/translate_row",
    "pipeline/skills/translate_page",
)
MODULE_FILES = (
    "backend/__init__.py",
    "backend/server.py",
    "backend/data/db.py",
    "backend/data/management_db.py",
    "backend/migrations/__init__.py",
    "backend/migrations/coordinator.py",
    "backend/migrations/families.py",
    "backend/migrations/runner.py",
    "backend/migrations/schema_audit.py",
    "pipeline/__init__.py",
    "pipeline/ai_client.py",
    "pipeline/skills/__init__.py",
)
# These imports are selected by strings (translation adapters, mail composition,
# reader adapters, Uvicorn and legacy domain facades). A missing module must not
# disappear from the discovered list and turn into a runtime-only failure.
DYNAMIC_MODULE_FILES = (
    "pipeline/skills/translate_row/scripts/translate_text.py",
    "pipeline/skills/translate_page/scripts/markdown_segmenter.py",
    "backend/security/keychain_manager.py",
    "backend/api/vault_routes.py",
    "backend/services/mail_ingester.py",
    "backend/services/workspace_service.py",
    *(
        f"backend/domains/mail/routes/{name}.py"
        for name in (
            "messages",
            "actions",
            "compose",
            "views",
            "attachments",
            "tags",
        )
    ),
)
# These are development artifacts or user-generated code, never shipped skills.
OMITTED_SOURCE_DIRS = frozenset(
    {
        "__pycache__",
        "tests",
        "approved",
        "pending",
        "rejected",
        "sandbox",
        "private_skills",
        "secrets",
        "logs",
        "cache",
        ".tmp",
        ".git",
    }
)
MIGRATIONS = (
    "actions_0001",
    "actions_0002",
    "automations_0001",
    "capability_audit_0001",
    "evaluations_0001",
    "health_0001",
    "jobs_0001",
    "literature_0001",
    "management_0001",
    "management_0002",
    "management_0003",
    "management_0004",
    "management_0005",
    "notebooks_0001",
    "notebooks_0002",
    "notebooks_0003",
    "notebooks_0004",
    "notebooks_0005",
    "personal_memory_0001",
    "quality_0001",
    "replay_0001",
    "semantic_memory_0001",
    "stream_journal_0001",
    "tool_registry_0001",
    "turns_0001",
    "vault_0001",
    "vault_0002",
    "vault_0003",
    "vault_0004",
)
# Keep paths relative to __file__ in model_catalog, runner, directive_tools,
# plugin_sandbox, plugin_catalog and csl_styles. Vault Templates are user data;
# script.py.mako is Alembic's legitimate runtime template, not local settings.
DATA_FILES = (
    "backend/data/model_catalog.json",
    "backend/config/stopwords.json",
    "config/stopwords.json",
    "backend/migrations/schema_fingerprints.json",
    "backend/migrations/alembic/env.py",
    "backend/migrations/alembic/script.py.mako",
    *(f"backend/migrations/alembic/versions/{name}.py" for name in MIGRATIONS),
    *(
        f"backend/agent/instructions/{name}.md"
        for name in (
            "gnosy",
            "protocol_test",
            "code_conventions",
            "tool_development",
            "error_handling",
        )
    ),
    "backend/agent/evals/universal_turns.json",
    "backend/agent/evals/response_quality.json",
    "backend/services/plugin_runtime/runner.mjs",
    # analytics_routes discovers SKILL.md on disk; keep the metadata of the two
    # bundled runtime skills alongside their separately collected Python code.
    "pipeline/skills/translate_row/SKILL.md",
    "pipeline/skills/translate_page/SKILL.md",
    "extensions/examples/catalog.json",
    "extensions/examples/hello-command/manifest.json",
    "extensions/examples/hello-command/main.js",
    "extensions/examples/vault-stats/manifest.json",
    "extensions/examples/vault-stats/main.js",
    "extensions/examples/clone-logger/manifest.json",
    "extensions/examples/clone-logger/backend.mjs",
    *(
        f"frontend/public/csl/styles/{name}.csl"
        for name in (
            "apa",
            "chicago-author-date",
            "ieee",
            "modern-language-association",
        )
    ),
)
# Any new file here must be reviewed, including otherwise legitimate templates.
# Shared directories backend/data and config contain local runtime state too;
# only their individually named resources above are selected/read.
RESOURCE_TREES = (
    "backend/migrations/alembic",
    "backend/agent/instructions",
    "backend/services/plugin_runtime",
    "frontend/public/csl/styles",
    "extensions/examples/hello-command",
    "extensions/examples/vault-stats",
    "extensions/examples/clone-logger",
)
OWNED_ROOTS = frozenset({"backend", "pipeline", "config", "frontend", "extensions"})
FORBIDDEN_DIRS = frozenset(
    {
        "secrets",
        "private_skills",
        "realdata",
        "localdata",
        "local_data",
        "vaults",
        "logs",
        "backups",
        ".gnosi",
        ".git",
        ".venv",
        "__pycache__",
    }
)
FORBIDDEN_NAMES = frozenset(
    {
        "params.yaml",
        "params.yml",
        "integrations.json",
        "credentials.json",
        "credentials.key",
        "token.json",
        "tokens.json",
        "identity.json",
        "scheduler_config.json",
        "scheduler_config.local.json",
        "zotero_db_config.json",
        "local_settings.py",
        "id_rsa",
        "id_ed25519",
        ".ds_store",
        "secret.json",
        "secrets.json",
        "secrets.yaml",
        "secrets.yml",
        "params.json",
    }
)
FORBIDDEN_SUFFIX = re.compile(
    r"(?:\.(?:db|sqlite|sqlite3)(?:$|[.\-])|\.log(?:$|\.)|\.(?:key|p12|pfx|bak)$)",
    re.IGNORECASE,
)
SECRET_LITERAL = re.compile(
    rb"""["'](?:access_token|refresh_token|client_secret|api_key|private_key|password)["']"""
    rb"""\s*[:=]\s*["']([^"'\r\n]+)["']""",
    re.IGNORECASE,
)
PLACEHOLDER = re.compile(rb"^(?:\{\{.*\}\}|\$\{[^}]+\}|<[^>]+>|REPLACE_ME)$")


class ResourcePolicyError(ValueError):
    """A required resource is missing, unreviewed, unsafe or contaminated."""


@dataclass(frozen=True)
class ResourcePlan:
    repository: Path
    resources: tuple[str, ...]
    modules: tuple[str, ...]
    module_files: tuple[str, ...]
    digests: tuple[tuple[str, str], ...]

    @property
    def datas(self) -> list[tuple[str, str]]:
        """PyInstaller inputs: individual files, never recursive directories."""
        return [
            (str(self.repository / name), str(PurePosixPath(name).parent))
            for name in self.resources
        ]


def _relative(name: str) -> PurePosixPath:
    normalized = name.replace("\\", "/")
    parts = normalized.split("/")
    if not normalized or any(part in {"", ".", ".."} for part in parts):
        raise ResourcePolicyError(f"Unsafe resource path: {name!r}")
    if any(":" in part or any(ord(char) < 32 for char in part) for part in parts):
        raise ResourcePolicyError(f"Unsafe resource path: {name!r}")
    if any(part != part.rstrip(" .") for part in parts):
        raise ResourcePolicyError(f"Ambiguous Windows resource path: {name!r}")
    return PurePosixPath(normalized)


def _check_name(name: str) -> PurePosixPath:
    relative = _relative(name)
    parts = tuple(part.casefold() for part in relative.parts)
    if (
        any(part in FORBIDDEN_DIRS or part.startswith(".env") for part in parts)
        or parts[-1] in FORBIDDEN_NAMES
        or FORBIDDEN_SUFFIX.search(parts[-1])
        or parts[-1].startswith("client_secret")
        or (parts[-1].startswith("credentials.") and parts[-1] != "credentials.py")
    ):
        raise ResourcePolicyError(f"Prohibited resource path: {name}")
    return relative


def _regular_path(root: Path, name: str, *, directory: bool = False) -> Path:
    relative = _relative(name)
    target = root
    for part in relative.parts:
        target = target / part
        if target.is_symlink():
            raise ResourcePolicyError(f"Symlink in owned resource: {name}")
    try:
        mode = target.stat().st_mode
    except OSError as error:
        raise ResourcePolicyError(f"Required resource missing: {name}") from error
    if not (stat.S_ISDIR(mode) if directory else stat.S_ISREG(mode)):
        raise ResourcePolicyError(
            f"Resource is not a regular {'directory' if directory else 'file'}: {name}"
        )
    return target


def _walk(root: Path, name: str, *, source_modules: bool = False) -> Iterable[str]:
    directory = _regular_path(root, name, directory=True)
    for child in sorted(directory.iterdir()):
        relative = child.relative_to(root).as_posix()
        # Do not descend into known unselected source trees or inspect their data.
        if source_modules and (child.name in OMITTED_SOURCE_DIRS or child.name.startswith(".")):
            continue
        # Bytecode left by development is not a resource. Bundle checks do NOT
        # make this exception, and symlinks can never use it to bypass checks.
        if not child.is_symlink() and child.name == "__pycache__":
            continue
        if child.is_symlink():
            raise ResourcePolicyError(f"Symlink in selected resource tree: {relative}")
        if child.is_dir():
            yield from _walk(root, relative, source_modules=source_modules)
        elif not source_modules or (
            child.suffix == ".py"
            and not child.name.startswith("test_")
            and not child.name.endswith("_test.py")
            and child.name != "conftest.py"
        ):
            yield relative


def _resource_digest(root: Path, name: str) -> str:
    _check_name(name)  # Never open a prohibited path, even for diagnostics.
    raw = _regular_path(root, name).read_bytes()
    _check_content(raw, name)
    for match in SECRET_LITERAL.finditer(raw):
        if not PLACEHOLDER.fullmatch(match.group(1)):
            # Never echo matched values, snippets or complete contents.
            raise ResourcePolicyError(f"Credential literal in resource: {name}")
    return hashlib.sha256(raw).hexdigest()


def _check_content(raw: bytes, name: str) -> None:
    if raw.startswith(b"SQLite format 3\x00") or re.search(
        rb"-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----",
        raw,
    ):
        raise ResourcePolicyError(f"Prohibited database/key content in resource: {name}")


def _module_name(name: str) -> str:
    path = PurePosixPath(name).with_suffix("")
    parts = path.parts[:-1] if path.name == "__init__" else path.parts
    if not all(part.isidentifier() for part in parts):
        raise ResourcePolicyError(f"Invalid module resource: {name}")
    return ".".join(parts)


def build_plan(repository: Path) -> ResourcePlan:
    """Read only selected source/resources; never import Gnosi or load its config."""
    repository = repository.resolve(strict=True)
    resources = tuple(sorted(DATA_FILES))
    allowed = set(resources)
    for tree in RESOURCE_TREES:
        for name in _walk(repository, tree):
            _check_name(name)
            if name not in allowed:
                raise ResourcePolicyError(f"Unreviewed file in selected resource tree: {name}")
    digests = tuple((name, _resource_digest(repository, name)) for name in resources)
    sources = set(MODULE_FILES + DYNAMIC_MODULE_FILES)
    for tree in MODULE_TREES:
        sources.update(_walk(repository, tree, source_modules=True))
    for name in sorted(sources):
        _check_name(name)
        _regular_path(repository, name)
    modules = tuple(sorted(_module_name(n) for n in sources))
    if len(set(modules)) != len(sources):
        raise ResourcePolicyError("Colliding runtime module names")
    return ResourcePlan(repository, resources, modules, tuple(sorted(sources)), digests)


def validate_analysis(
    datas: Iterable[TocEntry],
    pure: Iterable[TocEntry],
    binaries: Iterable[TocEntry],
    plan: ResourcePlan,
) -> None:
    """Check actual Analysis TOCs, including hook additions, before COLLECT.

    Third-party files remain PyInstaller's responsibility; they cannot inject
    files into owned namespaces or relabel an unselected repository file.
    """
    resources = set(plan.resources)
    found: set[str] = set()
    destinations: set[str] = set()
    for destination, source, kind in [*datas, *binaries]:
        path = _check_name(destination)
        name = path.as_posix()
        folded = name.casefold()
        if folded in destinations:
            raise ResourcePolicyError(f"Colliding Analysis destination: {name}")
        destinations.add(folded)
        owned = path.parts[0].casefold() in OWNED_ROOTS
        if kind == "SYMLINK":
            # A PyInstaller SYMLINK source is relative to its destination's
            # parent, not to cwd. Framework/library links are runtime assets.
            link = source.replace("\\", "/")
            if owned or link.startswith("/"):
                raise ResourcePolicyError(f"Unsafe Analysis symlink: {name}")
            target = _check_name(posixpath.normpath(posixpath.join(str(path.parent), link)))
            if (
                target.parts[0].casefold() in OWNED_ROOTS
                or target == path
                or target in path.parents
            ):
                raise ResourcePolicyError(f"Unsafe Analysis symlink: {name}")
            continue
        source_path = Path(source).absolute()
        from_repository = source_path.resolve().is_relative_to(plan.repository)
        if owned or from_repository:
            if name not in resources or kind != "DATA":
                raise ResourcePolicyError(f"Unreviewed owned Analysis resource: {name}")
            if source_path != plan.repository / name:
                raise ResourcePolicyError(f"Substituted Analysis resource: {name}")
            if _resource_digest(plan.repository, name) != dict(plan.digests)[name]:
                raise ResourcePolicyError(f"Changed Analysis resource: {name}")
            found.add(name)
    missing = resources - found
    if missing:
        raise ResourcePolicyError(f"Analysis is missing required resources: {sorted(missing)}")
    modules: set[str] = set()
    module_sources = {_module_name(item): plan.repository / item for item in plan.module_files}
    parents = {
        name.rsplit(".", index)[0]
        for name in plan.modules
        for index in range(1, name.count(".") + 1)
    }
    for name, source, _kind in pure:
        root_owned = name.split(".")[0].casefold() in OWNED_ROOTS
        # PyInstaller uses '-' for implicit namespace packages. Third-party
        # namespaces such as jaraco have no source file to classify; resolving
        # the sentinel as a relative path would falsely place it in the repo.
        if source == "-" and not root_owned:
            continue
        source_path = Path(source).absolute()
        if root_owned or source_path.resolve().is_relative_to(plan.repository):
            # PyInstaller6 uses '-' for implicit namespace packages (for
            # example backend.data). They have no source to inspect or copy.
            if name in parents and name not in module_sources and source == "-":
                continue
            if name not in plan.modules:
                raise ResourcePolicyError(f"Unreviewed owned Analysis module: {name}")
            if source_path != module_sources[name]:
                raise ResourcePolicyError(f"Substituted Analysis module: {name}")
            _regular_path(plan.repository, source_path.relative_to(plan.repository).as_posix())
            modules.add(name)
    if missing_modules := set(plan.modules) - modules:
        raise ResourcePolicyError(f"Analysis is missing runtime modules: {sorted(missing_modules)}")


def verify_bundle(bundle: Path, plan: ResourcePlan) -> None:
    """Read-only check of a PyInstaller6 onedir (or legacy flat onedir).

    Accepts dist-python or the copied python/ directory inside Electron
    resources. Raises on missing/changed required data or unreviewed owned
    files, without deleting anything. Does not execute the backend.
    """
    if bundle.is_symlink():
        raise ResourcePolicyError("Symlinked bundle root")
    bundle = bundle.resolve(strict=True)
    internal = bundle / "_internal"
    if internal.is_symlink():
        raise ResourcePolicyError("Symlinked bundle _internal directory")
    payload = internal if internal.is_dir() else bundle
    expected = dict(plan.digests)
    found: set[str] = set()

    def inspect(directory: Path) -> None:
        for child in sorted(directory.iterdir()):
            packaged_name = child.relative_to(bundle).as_posix()
            name = (
                child.relative_to(payload).as_posix()
                if child.is_relative_to(payload)
                else packaged_name
            )
            if child == internal:
                inspect(child)
                continue
            path = _check_name(name)
            owned = path.parts[0].casefold() in OWNED_ROOTS
            if child.is_symlink():
                # Python.framework includes directory links (Versions/Current,
                # Resources). Validate containment without traversing aliases.
                try:
                    target = child.resolve(strict=True)
                except (OSError, RuntimeError) as error:
                    raise ResourcePolicyError(
                        f"Invalid packaged symlink: {packaged_name}"
                    ) from error
                if (
                    owned
                    or not target.is_relative_to(bundle)
                    or not (target.is_file() or target.is_dir())
                    or target == child
                    or target in child.parents
                ):
                    raise ResourcePolicyError(f"Unsafe packaged symlink: {packaged_name}")
                continue
            if child.is_dir():
                if owned and not any(item.startswith(name + "/") for item in expected):
                    raise ResourcePolicyError(f"Unreviewed owned bundle directory: {packaged_name}")
                inspect(child)
            elif owned:
                if child.parent == bundle and payload != bundle:
                    raise ResourcePolicyError(f"Owned resource outside _internal: {packaged_name}")
                if name not in expected or child != payload / name:
                    raise ResourcePolicyError(f"Unreviewed owned bundle resource: {packaged_name}")
                if _resource_digest(payload, name) != expected[name]:
                    raise ResourcePolicyError(f"Changed packaged resource: {name}")
                found.add(name)
            else:
                # Check renamed databases too. Public CA certificates remain
                # valid dependencies; a private key in a PEM file never does.
                regular = _regular_path(bundle, packaged_name)
                with regular.open("rb") as handle:
                    header = (
                        handle.read() if regular.suffix.casefold() == ".pem" else handle.read(16)
                    )
                _check_content(header, packaged_name)

    inspect(bundle)
    if missing := set(expected) - found:
        raise ResourcePolicyError(f"Bundle is missing required resources: {sorted(missing)}")


def render_spec(repository: Path, helper_directory: Path) -> str:
    """Use repr for paths: spaces, quotes and Windows backslashes stay literal."""
    return f"""# -*- mode: python ; coding: utf-8 -*-
import sys
from pathlib import Path
sys.path.insert(0, {str(helper_directory)!r})
from backend_resources import build_plan, validate_analysis
from PyInstaller.utils.hooks import collect_submodules

plan = build_plan(Path({str(repository)!r}))
hiddenimports = list(plan.modules) + {list(THIRD_PARTY_IMPORTS)!r}
hiddenimports += collect_submodules('keyring.backends')
a = Analysis(
    [{str(repository / "backend/server.py")!r}],
    pathex=[{str(repository)!r}],
    binaries=[], datas=plan.datas, hiddenimports=hiddenimports,
    hookspath=[], runtime_hooks=[],
    excludes=['tkinter', 'test', 'matplotlib', 'pandas', 'scipy'],
    noarchive=False,
)
validate_analysis(a.datas, a.pure, a.binaries, plan)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, [], exclude_binaries=True,
          name='cervell_backend', debug=False, strip=False, upx=True,
          console=True, contents_directory='_internal')
coll = COLLECT(exe, a.binaries, a.datas, strip=False, upx=True,
               name='cervell_backend')
"""


# Preserve the previous dependency coverage and add Uvicorn's string-selected
# protocol/loop implementations plus Alembic's programmatic runtime.
THIRD_PARTY_IMPORTS = (
    "flask",
    "flask_cors",
    "fastapi",
    "uvicorn",
    "psutil",
    "pydantic",
    "numpy",
    "networkx",
    "requests",
    "httpx",
    "sqlalchemy",
    "alembic",
    "bs4",
    "feedparser",
    "dotenv",
    "yaml",
    "google_auth_httplib2",
    "googleapiclient",
    "google_auth_oauthlib",
    "gtts",
    "icalendar",
    "langchain",
    "langchain_core",
    "langchain_openai",
    "langchain_ollama",
    "langchain_groq",
    "langchain_anthropic",
    "langgraph",
    "langchain_chroma",
    "langgraph.checkpoint.sqlite.aio",
    "chromadb",
    "groq",
    "cloudinary",
    "simpleeval",
    "jinja2",
    "itsdangerous",
    "click",
    "werkzeug",
    "blinker",
    "dateutil",
    "six",
    "pytz",
    "tzdata",
    "pydantic_core",
    "pydantic_settings",
    "cryptography",
    "cffi",
    "pyasn1",
    "pyasn1_modules",
    "keyring",
    "httpcore",
    "h11",
    "anyio",
    "grpc",
    "google.protobuf",
    "google.api",
    "starlette",
    "typing_extensions",
    "importlib_metadata",
    "importlib_resources",
    "zipp",
    "jsonschema",
    "jsonschema_specifications",
    "referencing",
    "rpds",
    "pkg_resources",
    "setuptools",
    "uvicorn.logging",
    "uvicorn.loops.auto",
    "uvicorn.loops.asyncio",
    "uvicorn.loops.uvloop",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.http.h11_impl",
    "uvicorn.protocols.http.httptools_impl",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.protocols.websockets.websockets_impl",
    "uvicorn.protocols.websockets.websockets_sansio_impl",
    "uvicorn.protocols.websockets.wsproto_impl",
    "uvicorn.lifespan.on",
    "uvicorn.lifespan.off",
)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("spec", "check-source", "verify"))
    parser.add_argument("--repository", type=Path, required=True)
    parser.add_argument("--output", type=Path, help="Spec output path (spec only)")
    parser.add_argument("--bundle", type=Path, help="Built onedir (verify only)")
    args = parser.parse_args(argv)
    try:
        plan = build_plan(args.repository)
        if args.command == "spec":
            if args.output is None:
                parser.error("spec requires --output")
            args.output.write_text(
                render_spec(plan.repository, Path(__file__).resolve().parent), encoding="utf-8"
            )
        elif args.command == "verify":
            if args.bundle is None:
                parser.error("verify requires --bundle")
            verify_bundle(args.bundle, plan)
        LOG.info(
            "Resource policy passed: %s data files, %s modules",
            len(plan.resources),
            len(plan.modules),
        )
    except (OSError, ResourcePolicyError) as error:
        LOG.error("Backend resource policy failed: %s", error)
        return 1
    return 0


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    raise SystemExit(main())
