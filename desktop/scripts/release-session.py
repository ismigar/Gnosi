#!/usr/bin/env python3
"""Resume local release collection and clean only session-owned scratch after publication."""

from __future__ import annotations

import argparse
import base64
from contextlib import contextmanager
import hashlib
import json
import logging
import os
from pathlib import Path
import shutil
import subprocess
import sys
import uuid

ROOT = Path(__file__).resolve().parents[2]
REPO = "ismigar/Gnosi"
GROUPS = ("macos-arm64", "macos-x64", "linux-arm64", "windows-x64")
CHECKS = {"documentation", "backend", "frontend", "native-smoke", "docker"}
LOG = logging.getLogger(__name__)


def require(condition: object, message: str) -> None:
    if not condition:
        raise ValueError(message)


def command(*args: str, env: dict[str, str] | None = None) -> str:
    """Never evaluate shell text or include environment values in diagnostics."""
    result = subprocess.run(args, cwd=ROOT, env=env, capture_output=True, text=True, timeout=600)
    require(result.returncode == 0, f"Command failed: {args[0]} {args[1] if len(args) > 1 else ''}")
    return result.stdout.strip()


def digest(path: Path) -> str:
    result = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(4 * 1024 * 1024), b""):
            result.update(block)
    return result.hexdigest()


def read(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def write(path: Path, value: object) -> None:
    temporary = path.with_name(path.name + ".new")
    with temporary.open("x", encoding="utf-8") as stream:
        json.dump(value, stream, indent=2, sort_keys=True)
        stream.write("\n")
    temporary.replace(path)


def safe_directory(path: Path) -> Path:
    """Reject symlinks in every existing component, including session parents."""
    # Inspect the actual traversal before collapsing '..': link/.. can resolve
    # somewhere different from its lexical normalization.
    path = path if path.is_absolute() else Path.cwd() / path
    for component in (*reversed(path.parents), path):
        require(not component.is_symlink(), f"Symlink directory rejected: {component}")
        if component.exists():
            require(component.is_dir(), f"Not a directory: {component}")
    return path.resolve()


def inventory(root: Path) -> list[dict]:
    safe_directory(root)
    result = []
    for path in sorted(root.rglob("*")):
        require(not path.is_symlink(), f"Symlink rejected: {path}")
        if path.is_file():
            result.append({"path": path.relative_to(root).as_posix(), "bytes": path.stat().st_size,
                           "sha256": digest(path)})
        else:
            require(path.is_dir(), f"Special file rejected: {path}")
            require(next(path.iterdir(), None) is not None, f"Empty directory rejected: {path}")
    return result


def source_identity(version: str) -> dict:
    commit = command("git", "rev-parse", "HEAD")
    environment = {**os.environ, "RELEASE_EVENT": "workflow_dispatch", "REQUESTED_TAG": f"v{version}",
                   "EXPECTED_SHA": commit}
    command("node", "desktop/scripts/release-source-identity.cjs", env=environment)
    require(not command("git", "status", "--porcelain", "--untracked-files=all"),
            "Use a committed clean release checkout")
    return {"commit": commit, "tree": command("git", "rev-parse", "HEAD^{tree}"),
            "locks": {name: digest(ROOT / name) for name in ("pnpm-lock.yaml", "uv.lock")}}


def doctor(min_free_gib: int, *, signing: bool) -> dict:
    require(shutil.disk_usage(ROOT).free >= min_free_gib * 1024**3,
            f"Need at least {min_free_gib} GiB free before starting release work")
    command("node", "scripts/verify-toolchain.mjs")
    command("node", "-e", "require('./desktop/scripts/release-artifacts.cjs')")
    command("gh", "auth", "status")
    command("uv", "sync", "--frozen", "--check", "--inexact")
    runners = github("actions/runners?per_page=100").get("runners", [])
    for labels in ({"linux", "arm64"}, {"macos", "arm64"}, {"macos", "x64"}):
        require(any(runner.get("status") == "online" and labels <= {
            label["name"].lower() for label in runner.get("labels", [])
        } for runner in runners), f"Required CI runner is offline: {sorted(labels)}")
    if signing:
        require(bool(os.environ.get("GNOSI_PLUGIN_SIGNING_KEY", "").strip()),
                "Configure GNOSI_PLUGIN_SIGNING_KEY with the existing official key before building")
        command("uv", "run", "--frozen", "--no-sync", "python", "-c",
                "from extensions.marketplace.signing_policy import load_official_private_key; "
                "load_official_private_key()")
    return {"free_bytes": shutil.disk_usage(ROOT).free, "toolchain": "passed",
            "github_auth": "passed", "ci_runners": "online",
            "official_catalog_signing": "passed" if signing else "not_requested"}


def initialize(path: Path, version: str, min_free_gib: int) -> None:
    identity = source_identity(version)
    path = safe_directory(path)
    require(not path.exists(), "Session directory already exists; resume it instead")
    require(path.parent.is_dir(), "Create the session parent directory first")
    require(shutil.disk_usage(path.parent).free >= min_free_gib * 1024**3,
            f"Need at least {min_free_gib} GiB free on the session volume")
    path.mkdir(mode=0o700)
    token = str(uuid.uuid4())
    for name in ("scratch", "evidence"):
        (path / name).mkdir()
    (path / "scratch" / ".release-owner").write_text(token, encoding="utf-8")
    (path / "scratch" / "groups").mkdir()
    write(path / "session.json", {"schema": 1, "id": token, "version": version, "source": identity,
                                 "groups": {}, "acceptance": {}, "assembled": False,
                                 "retained": {}, "cleaned": False})


@contextmanager
def session(path: Path):
    """Serialize all commands; a crashed lock requires deliberate operator recovery."""
    path = safe_directory(path)
    require((path / "session.json").is_file() and not (path / "session.json").is_symlink(),
            "Missing or unsafe session manifest")
    lock = path / ".session-lock"
    require(not lock.exists(), "Session is busy; inspect any interrupted command before removing its lock")
    lock.mkdir()
    try:
        state = read(path / "session.json")
        require(state.get("schema") == 1 and isinstance(state.get("id"), str), "Unsupported session")
        safe_directory(path / "evidence")
        verify_retained(path, state)
        require(state["source"] == source_identity(state["version"]), "Release source or locks changed")
        if not state["cleaned"] and not state.get("cleanup_started"):
            verify_scratch(path, state)
        yield path, state
    finally:
        lock.rmdir()


def save(path: Path, state: dict) -> None:
    write(path / "session.json", state)


def verify_scratch(path: Path, state: dict) -> Path:
    scratch = safe_directory(path / "scratch")
    owner = scratch / ".release-owner"
    require(owner.is_file() and not owner.is_symlink() and owner.read_text() == state["id"],
            "Scratch ownership marker does not match")
    return scratch


def verify_retained(path: Path, state: dict) -> None:
    """Seal all generated manifests and remote receipts as well as installer proofs."""
    safe_directory(path / "evidence")
    require(isinstance(state.get("retained"), dict), "Missing retained evidence ledger")
    for name, item in state["retained"].items():
        target = path / "evidence" / name
        require(Path(name).name == name and not target.is_symlink() and target.is_file()
                and target.stat().st_size == item["bytes"] and digest(target) == item["sha256"],
                f"Retained evidence changed or is missing: {name}")
    if state["assembled"]:
        require("public-manifest.json" in state["retained"]
                and read(path / "evidence/public-manifest.json") == state["public"],
                "Retained public manifest does not match the sealed candidate")


def retain_json(path: Path, state: dict, name: str, value: object) -> None:
    verify_retained(path, state)
    require(Path(name).name == name, "Retained receipt name must be a single filename")
    target = path / "evidence" / name
    require(not target.is_symlink(), "Symlink receipt target rejected")
    require(not target.exists() or name in state["retained"],
            "Unregistered evidence already occupies the generated receipt path")
    write(target, value)
    state["retained"][name] = {"bytes": target.stat().st_size, "sha256": digest(target)}
    save(path, state)


def import_group(path: Path, state: dict, group: str, source: Path) -> None:
    require(not state["cleaned"], "Session is already cleaned")
    require(not state["assembled"], "Candidate is sealed; use a new session for changed artifacts")
    source = safe_directory(source)
    command("node", "desktop/scripts/release-artifacts.cjs", "validate", group, str(source))
    actual = inventory(source)
    groups = safe_directory(verify_scratch(path, state) / "groups")
    destination = groups / group
    if group in state["groups"]:
        require(actual == state["groups"][group] == inventory(destination),
                "Imported group changed; use a new session")
        return
    require(not destination.exists(), "Interrupted import exists; inspect it before retrying")
    shutil.copytree(source, destination)
    require(inventory(destination) == actual, "Group changed during import")
    state["groups"][group] = actual
    save(path, state)


def verify_groups(path: Path, state: dict) -> None:
    require(set(state["groups"]) == set(GROUPS), "All four architecture groups are required")
    require({item.name for item in (path / "scratch" / "groups").iterdir()} == set(GROUPS),
            "Unexpected architecture directory; inspect it before cleanup")
    for group in GROUPS:
        require(inventory(path / "scratch" / "groups" / group) == state["groups"][group],
                f"Artifact group changed: {group}")


def prepare_public_notes(path: Path, state: dict) -> None:
    """Label the stable publication payload without promoting the tagged app/catalog."""
    if "-" in state["version"].split("+", 1)[0]:
        return
    catalog = read(ROOT / "frontend/src/features/control-center/releases/releases.json")
    entry = next(item for item in catalog if item["version"] == state["version"])
    labels = read(ROOT / "frontend/src/shared/i18n/locales/en/translation.json")["release_notes"]
    lines = path.read_text(encoding="utf-8").split("\n")
    require(len(lines) > 2 and lines[2] == f"_{entry['date']} · {labels['channel_' + entry['channel']]}_",
            "Unexpected rendered release-note header")
    lines[2] = f"_{entry['date']} · {labels['channel_stable']}_"
    path.write_text("\n".join(lines), encoding="utf-8")


def assemble(path: Path, state: dict) -> None:
    require(not state["cleaned"], "Session is already cleaned")
    verify_groups(path, state)
    verify_retained(path, state)
    if state["assembled"]:
        require(inventory(path / "scratch" / "public") == state["public"], "Sealed candidate changed")
        return
    # Fail before collection/copies when the existing official key is unavailable.
    command("uv", "run", "--frozen", "--no-sync", "python", "-c",
            "from extensions.marketplace.signing_policy import load_official_private_key; "
            "load_official_private_key()")
    destination = path / "scratch" / "public"
    require(not destination.exists(), "Interrupted assembly exists; inspect it before retrying")
    command("node", "desktop/scripts/release-artifacts.cjs", "collect",
            str(path / "scratch" / "groups"), str(destination), f"v{state['version']}")
    command("node", "desktop/scripts/sparkle-appcast.cjs", "verify-collected", str(destination))
    base_url = f"https://github.com/{REPO}/releases/download/v{state['version']}"
    for script, output in (("extensions/examples/build_index.py", "plugins"),
                           ("extensions/marketplace/build_vault_templates.py", "vault-templates")):
        module = script.removesuffix(".py").replace("/", ".")
        command("uv", "run", "--frozen", "--no-sync", "python", "-m", module, "--base-url", base_url,
                "--out", str(destination / output))
    command("node", "frontend/scripts/release-notes.mjs", "--version", f"v{state['version']}",
            "--output", str(destination / "release-notes.md"))
    prepare_public_notes(destination / "release-notes.md", state)
    command("uv", "run", "--frozen", "--no-sync", "python", "-m",
            "extensions.marketplace.verify_release_candidate", "--artifacts", str(destination))
    state["public"] = inventory(destination)
    names = [Path(item["path"]).name for item in state["public"]]
    require(len(names) == len(set(names)), "Flat GitHub asset names collide")
    require(source_identity(state["version"]) == state["source"], "Source changed during assembly")
    retain_json(path, state, "public-manifest.json", state["public"])
    state["assembled"] = True
    save(path, state)


def acceptance(path: Path, state: dict, group: str, mode: str, receipt: Path) -> None:
    """Record operator-produced installation evidence; never infer it from a build."""
    require(state["assembled"] and not state["cleaned"], "Assemble the immutable candidate first")
    verify_retained(path, state)
    receipt = safe_directory(receipt.parent) / receipt.name
    require(receipt.is_file() and not receipt.is_symlink(), "Missing or unsafe acceptance receipt")
    document = read(receipt)
    expected = {"source": state["source"], "group": group, "mode": mode, "status": "passed",
                "artifacts": state["groups"][group]}
    require(all(document.get(key) == value for key, value in expected.items()),
            "Acceptance receipt must bind passed installation evidence to this source and artifact group")
    require(isinstance(document.get("evidence"), list) and document["evidence"],
            "Acceptance receipt must reference installation/persistence evidence files")
    key = f"{group}-{mode}"
    destination = path / "evidence" / key
    require(not destination.exists(), "Acceptance evidence already exists; inspect before replacing it")
    sources = []
    for item in document["evidence"]:
        require(isinstance(item, str), "Evidence paths must be strings")
        source = receipt.parent / item
        source = safe_directory(source.parent) / source.name
        require(source.is_file() and not source.is_symlink(), "Missing or unsafe installation evidence")
        sources.append(source)
    destination.mkdir()
    copied = []
    for index, source in enumerate(sources):
        target = destination / f"{index}-{source.name}"
        shutil.copyfile(source, target)
        copied.append({"kind": "proof", "path": target.relative_to(path).as_posix(), "bytes": target.stat().st_size,
                       "sha256": digest(target)})
    saved_receipt = destination / "receipt.json"
    write(saved_receipt, document)
    copied.append({"kind": "receipt", "path": saved_receipt.relative_to(path).as_posix(),
                   "bytes": saved_receipt.stat().st_size, "sha256": digest(saved_receipt)})
    state["acceptance"][key] = copied
    save(path, state)


def github(endpoint: str) -> dict:
    return json.loads(command("gh", "api", f"repos/{REPO}/{endpoint}"))


def verify_acceptance(path: Path, state: dict) -> None:
    verify_retained(path, state)
    required = {f"{group}-{mode}" for group in GROUPS for mode in ("fresh", "upgrade")}
    require(set(state["acceptance"]) == required, "All eight installer acceptance gates are required")
    for key, files in state["acceptance"].items():
        require(files, "Installation evidence is missing")
        receipts = [item for item in files if item.get("kind") == "receipt"]
        require(len(receipts) == 1 and any(item.get("kind") == "proof" for item in files)
                and receipts[0]["path"] == f"evidence/{key}/receipt.json",
                "A sealed acceptance receipt and installation proofs are required")
        for item in files:
            evidence = path / item["path"]
            safe_directory(evidence.parent)
            require((path / "evidence") in evidence.resolve().parents and not evidence.is_symlink()
                    and evidence.is_file() and digest(evidence) == item["sha256"], "Acceptance evidence changed")
        group, mode = key.rsplit("-", 1)
        receipt = read(path / receipts[0]["path"])
        expected = {"source": state["source"], "group": group, "mode": mode, "status": "passed",
                    "artifacts": state["groups"][group]}
        require(all(receipt.get(name) == value for name, value in expected.items()),
                "Acceptance receipt no longer binds passed installation evidence to this candidate")


def verify_public_assets(state: dict, release: dict, *, complete: bool) -> None:
    expected = {Path(item["path"]).name: item for item in state["public"]}
    actual = release.get("assets", [])
    names = {item["name"] for item in actual}
    require(len(actual) == len(names) and names <= set(expected), "Unexpected or duplicate public assets")
    require(not complete or names == set(expected), "Published asset set differs from the sealed candidate")
    for asset in actual:
        item = expected[asset["name"]]
        require(asset.get("state") == "uploaded" and asset.get("size") == item["bytes"]
                and asset.get("digest") == "sha256:" + item["sha256"],
                f"Published asset mismatch or missing GitHub digest: {asset['name']}")


def verify_remote_tag(state: dict) -> None:
    tag = f"v{state['version']}"
    ref = github(f"git/ref/tags/{tag}")["object"]
    if ref["type"] == "tag":
        ref = github(f"git/tags/{ref['sha']}")["object"]
    require(ref["type"] == "commit" and ref["sha"] == state["source"]["commit"],
            "Remote release tag changed")


def publish(path: Path, state: dict, ci_run: int) -> None:
    """Resume a draft upload without overwriting assets; never bypass installer/CI gates."""
    require(state["assembled"] and not state["cleaned"], "Assemble a current release candidate first")
    require("-" not in state["version"].split("+", 1)[0], "Publication supports stable versions only")
    verify_acceptance(path, state)
    verify_groups(path, state)
    public = path / "scratch" / "public"
    require(inventory(public) == state["public"], "Sealed candidate changed")
    verify_remote_tag(state)
    run = github(f"actions/runs/{ci_run}")
    require(run.get("head_sha") == state["source"]["commit"] and run.get("conclusion") == "success"
            and run.get("path") == ".github/workflows/ci.yml"
            and run.get("repository", {}).get("full_name") == REPO,
            "Supply the successful complete CI run for this exact source commit")
    jobs = github(f"actions/runs/{ci_run}/jobs?per_page=100").get("jobs", [])
    for name in CHECKS:
        matches = [item for item in jobs if item["name"] == name]
        require(len(matches) == 1 and matches[0].get("conclusion") == "success",
                f"Required source CI job is not successful: {name}")
    retain_json(path, state, f"source-ci-{ci_run}.json", {"run": run, "jobs": jobs})
    tag = f"v{state['version']}"
    # Creation fails safely if a matching older release is outside this first page.
    releases = github("releases?per_page=100")
    matching = [item for item in releases if item["tag_name"] == tag]
    require(len(matching) <= 1, "Ambiguous existing release")
    if not matching:
        command("gh", "release", "create", tag, "--repo", REPO, "--draft", "--verify-tag",
                "--title", f"Gnosi {state['version']}", "--notes-file", str(public / "release-notes.md"))
    remote = github(f"releases/tags/{tag}")
    require(remote.get("tag_name") == tag and not remote.get("prerelease"), "Wrong release target")
    require(remote.get("body", "").strip() == (public / "release-notes.md").read_text().strip(),
            "Existing release notes differ from the sealed candidate")
    verify_public_assets(state, remote, complete=not remote.get("draft"))
    if remote.get("draft"):
        present = {asset["name"] for asset in remote.get("assets", [])}
        for item in state["public"]:
            if Path(item["path"]).name not in present:
                command("gh", "release", "upload", tag, str(public / item["path"]), "--repo", REPO)
        remote = github(f"releases/tags/{tag}")
        verify_public_assets(state, remote, complete=True)
        verify_remote_tag(state)
        require(source_identity(state["version"]) == state["source"], "Source changed during upload")
        command("gh", "release", "edit", tag, "--repo", REPO, "--draft=false", "--prerelease=false")
    remote = github(f"releases/tags/{tag}")
    require(not remote.get("draft") and remote.get("published_at"), "Publication is not confirmed")
    verify_public_assets(state, remote, complete=True)
    retain_json(path, state, "published-release.json", remote)
    LOG.info("Published %s. Promote reviewed metadata, then finalize with its merged PR number.", tag)


def verify_remote(state: dict, promotion_pr: int) -> dict:
    """Use fresh GitHub data; stored success receipts alone never permit deletion."""
    tag = f"v{state['version']}"
    release = github(f"releases/tags/{tag}")
    require(release.get("tag_name") == tag and not release.get("draft")
            and not release.get("prerelease") and release.get("published_at"),
            "Release has not been published")
    verify_public_assets(state, release, complete=True)
    verify_remote_tag(state)
    pr = github(f"pulls/{promotion_pr}")
    require(pr.get("merged") and pr["base"]["ref"] == "main"
            and pr["head"]["repo"]["full_name"] == REPO, "Promotion PR is not merged into main")
    comparison = github(f"compare/{state['source']['commit']}...{pr['merge_commit_sha']}")
    allowed = {"CHANGELOG.md", "frontend/src/features/control-center/releases/releases.json"}
    changes = comparison.get("files", [])
    require(comparison.get("merge_base_commit", {}).get("sha") == state["source"]["commit"]
            and len(changes) == len(allowed) and {item["filename"] for item in changes} == allowed
            and all(item.get("status") == "modified" and "previous_filename" not in item for item in changes),
            "Promotion must differ from the tested source only in release metadata")
    catalog_file = github("contents/frontend/src/features/control-center/releases/releases.json"
                          f"?ref={pr['merge_commit_sha']}")
    catalog = json.loads(base64.b64decode(catalog_file["content"]))
    entries = [item for item in catalog if item.get("version") == state["version"]]
    require(len(entries) == 1 and entries[0].get("channel") == "stable"
            and entries[0].get("downloadUrl") == f"https://github.com/{REPO}/releases/tag/{tag}",
            "Merged promotion does not announce this published stable release")
    checks = github(f"commits/{pr['head']['sha']}/check-runs?per_page=100").get("check_runs", [])
    for name in CHECKS:
        matches = [item for item in checks if item["name"] == name]
        require(len(matches) == 1 and matches[0].get("conclusion") == "success"
                and matches[0].get("head_sha") == pr["head"]["sha"]
                and matches[0].get("app", {}).get("slug") == "github-actions",
                f"Required promotion check is not successful: {name}")
    return {"release": release, "promotion": pr, "comparison": comparison, "checks": checks}


def finalize(path: Path, state: dict, promotion_pr: int) -> None:
    require(state["assembled"], "No sealed release candidate")
    verify_acceptance(path, state)
    remote = verify_remote(state, promotion_pr)
    retain_json(path, state, f"publication-{uuid.uuid4()}.json", remote)
    if state["cleaned"]:
        if "cleanup.json" not in state["retained"]:
            retain_json(path, state, "cleanup.json", state["cleanup"])
        return
    require(not state.get("cleanup_started"),
            "Cleanup was interrupted; inspect retained evidence and remaining scratch before recovery")
    verify_groups(path, state)
    require(inventory(path / "scratch" / "public") == state["public"], "Sealed candidate changed")
    # Evidence under scratch is never inferred disposable, even with matching ownership.
    require({item.name for item in (path / "scratch").iterdir()} == {".release-owner", "groups", "public"},
            "Unexpected scratch content; inspect it instead of deleting it automatically")
    free_before = shutil.disk_usage(path).free
    require(source_identity(state["version"]) == state["source"], "Source changed before cleanup")
    state["cleanup_started"] = True
    save(path, state)
    scratch = verify_scratch(path, state)
    shutil.rmtree(scratch)
    state["cleaned"] = True
    state["cleanup"] = {"promotion_pr": promotion_pr, "before_free_bytes": free_before,
                        "after_free_bytes": shutil.disk_usage(path).free}
    save(path, state)
    retain_json(path, state, "cleanup.json", state["cleanup"])


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="action", required=True)
    check = sub.add_parser("doctor", help="Check disk, frozen dependencies, GitHub auth and official signing")
    check.add_argument("--min-free-gib", type=int, default=24)
    check.add_argument("--signing", action="store_true")
    init = sub.add_parser("init", help="Pin a tagged clean source and create a new owned session")
    init.add_argument("version")
    init.add_argument("session", type=Path)
    init.add_argument("--min-free-gib", type=int, default=24)
    for name in ("import", "assemble", "accept", "receipt-template", "publish", "finalize", "status"):
        action = sub.add_parser(name)
        action.add_argument("session", type=Path)
        if name in {"import", "accept", "receipt-template"}:
            action.add_argument("group", choices=GROUPS)
        if name == "import":
            action.add_argument("source", type=Path)
        if name in {"accept", "receipt-template"}:
            action.add_argument("mode", choices=("fresh", "upgrade"))
            action.add_argument("receipt", type=Path)
        if name == "finalize":
            action.add_argument("--promotion-pr", type=int, required=True)
        if name == "publish":
            action.add_argument("--ci-run", type=int, required=True)
    args = parser.parse_args()
    if args.action == "doctor":
        require(args.min_free_gib > 0, "Minimum free space must be positive")
        LOG.info("Preflight: %s", doctor(args.min_free_gib, signing=args.signing))
    elif args.action == "init":
        require(args.min_free_gib > 0, "Minimum free space must be positive")
        initialize(args.session, args.version, args.min_free_gib)
    else:
        with session(args.session) as (path, state):
            if args.action == "import":
                import_group(path, state, args.group, args.source)
            elif args.action == "assemble":
                assemble(path, state)
            elif args.action == "accept":
                acceptance(path, state, args.group, args.mode, args.receipt)
            elif args.action == "receipt-template":
                require(args.group in state["groups"], "Import the architecture group first")
                require(not args.receipt.exists(), "Receipt already exists")
                write(args.receipt, {"source": state["source"], "group": args.group, "mode": args.mode,
                                     "status": "pending", "artifacts": state["groups"][args.group],
                                     "evidence": []})
            elif args.action == "publish":
                publish(path, state, args.ci_run)
            elif args.action == "finalize":
                finalize(path, state, args.promotion_pr)
            else:
                LOG.info("Session: %s", json.dumps(state, indent=2))


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    try:
        main()
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        LOG.error("Release session stopped: %s", error)
        sys.exit(1)
