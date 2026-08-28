import errno
import logging
import os
from pathlib import Path
import re
import subprocess
import time
from typing import Any, Dict, List, Optional, cast

from backend.domains.graph.adapters import yaml
from backend.services.frontmatter_fallback import parse_frontmatter_fallback


log = logging.getLogger(__name__)


COLOR_PALETTE = {
    "page": "#10b981",  # Emerald (Permanent)
    "unresolved": "#cbd5e1",  # Slate (Obsidian unresolved link)
    "default": "#94a3b8",  # Slate
}


def _string_to_color(value: str) -> str:
    """Return the deterministic colour used by the graph client for a label."""
    color_hash = 0
    for character in value:
        color_hash = ord(character) + ((color_hash << 5) - color_hash)
    return "#" + "".join(f"{(color_hash >> (index * 8)) & 0xFF:02x}" for index in range(3))


def _cluster_label(value: Any) -> Optional[str]:
    """Normalize a stored cluster or tag value into a displayable label."""
    if isinstance(value, dict):
        value = value.get("name") or value.get("label")
    if value is None:
        return None
    label = str(value).strip()
    return label or None


def _node_cluster(metadata: Dict[str, Any], attrs: Dict[str, Any]) -> Optional[str]:
    """Get the primary user-defined cluster from graph attributes or metadata."""
    cluster = _cluster_label(attrs.get("cluster") or metadata.get("cluster"))
    if cluster:
        return cluster
    tags = metadata.get("tags") or attrs.get("tags") or []
    if isinstance(tags, (str, dict)):
        tags = [tags]
    return _cluster_label(tags[0]) if tags else None


IGNORED_DIRS = {
    "node_modules",
    ".venv",
    ".git",
    ".tmp",
    "dist",
    "build",
    "target",
    ".cache",
    "__pycache__",
    "Plantilles",
    "Library",
    ".gemini",
    # System folders managed by dedicated services (not wiki pages)
    # Contacts and Images are cloud-only on OneDrive: rglob/scandir takes ~18s via FUSE.
    # Contacts are added from SQLite by _add_contact_nodes.
    "Mail",
    "Calendar",
    "Contacts",
    "Contactes",
    "Images",
    "system",
    "custom_icons",
    "data",
}


_STATUS_IDEA_RE = re.compile(r"\bidea\b", re.IGNORECASE)


_KIND_PATTERNS = (
    (re.compile(r"(^|[\s_\-])(reading|lectura)\w{0,4}(?=[\s_\-]|$)", re.IGNORECASE), "reading"),
    (re.compile(r"(^|[\s_\-])permanent\w{0,4}(?=[\s_\-]|$)", re.IGNORECASE), "permanent"),
    (re.compile(r"(^|[\s_\-])(index|índex)\w{0,4}(?=[\s_\-]|$)", re.IGNORECASE), "index"),
    (
        re.compile(r"(^|[\s_\-])(journal|diari|bitàcora)\w{0,4}(?=[\s_\-]|$)", re.IGNORECASE),
        "journal",
    ),
    (
        re.compile(r"(^|[\s_\-])(dialogue|diàleg|dialogo)\w{0,4}(?=[\s_\-]|$)", re.IGNORECASE),
        "dialogue",
    ),
    (re.compile(r"(^|[\s_\-])contact\w{0,4}(?=[\s_\-]|$)", re.IGNORECASE), "contact"),
    (re.compile(r"(^|[\s_\-])(calendar|event)\w{0,4}(?=[\s_\-]|$)", re.IGNORECASE), "calendar"),
    (re.compile(r"(^|[\s_\-])(mail|email)\w{0,4}(?=[\s_\-]|$)", re.IGNORECASE), "mail"),
)


_DIR_WARMUP_REQUESTED: Dict[str, float] = {}


_DIR_WARMUP_THROTTLE_S = 300.0


def _request_dir_warmup(dir_path: Path) -> None:
    """Best-effort: ask LaunchServices to open a wedged online-only directory.

    A process running under launchd cannot trigger OneDrive's on-access
    materialization (the File Provider returns EDEADLK instantly — see
    feedback_onedrive_warmup_native and files_provider/onedrive.py). Opening the
    directory from the user's Aqua session (Finder, via `open -g -j`) does
    hydrate it, which is the same mechanism ONEDRIVE_WARMUP_MODE=open uses for
    files. Fire-and-forget: we never wait for hydration here; the next graph
    rebuild simply picks the directory up once it's readable.

    Only runs when the effective warmup mode is "open" (native macOS); in
    "daemon" mode (Docker) the backend has no LaunchServices access, and the
    walk's skip+log behaviour is already the correct degradation.
    """
    try:
        from backend.platform.files.onedrive import _default_warmup_mode

        mode = (os.environ.get("ONEDRIVE_WARMUP_MODE") or _default_warmup_mode()).strip().lower()
        if mode != "open":
            return
        key = str(dir_path)
        now = time.monotonic()
        # Membership check, NOT a 0.0 default: `time.monotonic()` is measured
        # from an arbitrary epoch (system boot on Linux and on the macOS builds
        # we ship), so `now - 0.0 < THROTTLE` silently swallows the FIRST
        # request for every directory whenever monotonic() is still below the
        # window — i.e. during the first 5 minutes of uptime, exactly when the
        # LaunchAgent starts and OneDrive subtrees are coldest.
        last = _DIR_WARMUP_REQUESTED.get(key)
        if last is not None and now - last < _DIR_WARMUP_THROTTLE_S:
            return
        _DIR_WARMUP_REQUESTED[key] = now
        # `-g` keeps Finder in the background, `-j` launches hidden: no focus steal.
        subprocess.Popen(
            ["/usr/bin/open", "-g", "-j", key],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        log.info(f"☁️ Requested Finder warmup for wedged directory {dir_path}")
    except Exception as e:
        # warning, not debug: this except only sees genuine failures — the
        # "not applicable here" cases (wrong mode, throttled) return early
        # without raising. At debug level a broken warmup was indistinguishable
        # from a working one, which is how the throttle bug fixed in #890 stayed
        # invisible: the request was dropped and nothing said so.
        log.warning(f"Directory warmup request failed for {dir_path}: {e}")


def get_markdown_files_efficient(
    root_path: Path, skipped_dirs: Optional[List[str]] = None
) -> List[Path]:
    """Efficiently finds all .md files skipping IGNORED_DIRS.

    Unreadable directories are skipped (and logged) instead of aborting the
    whole walk: on OneDrive, listing a non-materialized subtree from a launchd
    process raises EDEADLK (errno 11) / EAGAIN — one wedged folder used to turn
    the entire scan (and GET /api/graph) into a 500. Skipped paths are appended
    to ``skipped_dirs`` when provided, so callers can flag the result as
    partial instead of caching it as complete, and a background hydration of
    the wedged directory is requested (see _request_dir_warmup).
    """
    md_files = []
    try:
        for entry in os.scandir(root_path):
            if entry.is_dir():
                if entry.name in IGNORED_DIRS or entry.name.startswith("."):
                    continue
                md_files.extend(get_markdown_files_efficient(Path(entry.path), skipped_dirs))
            elif entry.is_file() and entry.name.endswith(".md") and not entry.name.startswith("."):
                md_files.append(Path(entry.path))
    except (PermissionError, FileNotFoundError):
        pass
    except OSError as e:
        # Cloud-FS wedged subtree (or any other listing failure): skip it and
        # keep walking so the rest of the vault still reaches the graph.
        log.warning(f"Skipping unreadable directory {root_path}: {e}")
        if skipped_dirs is not None:
            skipped_dirs.append(str(root_path))
        if e.errno in (errno.EDEADLK, errno.EAGAIN):
            _request_dir_warmup(root_path)
    return md_files


def parse_section_links(content: str) -> dict[str | None, list[str]]:
    """Extracts wikilinks from the .md body grouped by heading.

    Returns {heading_str: [link, ...], None: [link, ...]}
    where None = links before the first heading.
    Ignores :::gnosi-ignore blocks and ```code``` blocks to avoid duplicating Notion artifacts.

    """
    # Strip frontmatter
    match = re.match(r"^---\s*\n.*?\n---\s*\n", content, re.DOTALL)
    body = content[match.end() :] if match else content

    sections: dict[str | None, list[str]] = {None: []}
    current_heading: str | None = None
    in_ignore = False
    in_code = False

    for line in body.split("\n"):
        stripped = line.strip()

        # Track :::gnosi-ignore blocks (Notion artifacts — they don't count towards the graph)
        if stripped.startswith(":::gnosi-ignore"):
            in_ignore = True
            continue
        if in_ignore:
            if stripped == ":::":
                in_ignore = False
            continue

        # Track code fences
        if stripped.startswith("```"):
            in_code = not in_code
            continue
        if in_code:
            continue

        heading = _section_heading(stripped)
        if heading is not None:
            current_heading = heading
            if current_heading not in sections:
                sections[current_heading] = []
            continue

        for target in _wikilink_targets(line):
            bucket = sections.setdefault(current_heading, [])
            bucket.append(target)

    return sections


def _section_heading(line: str) -> str | None:
    match = re.match(r"^(#{1,6})\s+(.+)$", line)
    return match.group(2).strip() if match else None


def _wikilink_targets(line: str) -> list[str]:
    return [
        target
        for raw in re.findall(r"\[\[(.*?)\]\]", line)
        if (target := raw.split("|")[0].split("#")[0].strip())
    ]


def parse_frontmatter(content: str, file_path: Optional[Path] = None) -> tuple[Dict[str, Any], str]:
    """Parses a markdown file for YAML frontmatter and body.

    ``file_path`` is optional and used only for logging context if parsing fails.
    """
    match = re.match(r"^---\s*\n(.*?)\n---\s*\n", content, re.DOTALL)
    if match:
        yaml_content = match.group(1)
        body = content[match.end() :]
        try:
            metadata = cast(Dict[str, Any], yaml.safe_load(yaml_content) or {})
            # Stripping of relation wikilinks ('[[Title|id]]' → id) is done
            # by the caller using the table's SCHEMA: here (a free function) it's not
            # known which fields are relation fields.
            return metadata, body
        except yaml.YAMLError as e:
            # Tolerant rescue, SAME as the Vault (vault_routes.parse_frontmatter):
            # without this, a page with slightly malformed YAML (an unclosed quote,
            # a tab, a reserved indicator…) would come out EMPTY in the graph (without title/
            # type/color) even though it read fine in the Vault.
            fallback_metadata = parse_frontmatter_fallback(yaml_content)
            if fallback_metadata:
                return cast(Dict[str, Any], fallback_metadata), body
            location = f" in {file_path}" if file_path else ""
            # debug level to avoid log spam if some pages have bad frontmatter
            log.debug(f"Error parsing YAML frontmatter{location}: {e}")
            return {}, content
    return {}, content


def _resolve_active_vault_path(cfg: Any) -> Path | None:
    """Prefer the request's active vault over the env-default VAULT.

    `cfg.paths` always reflects the env-default vault, so a multi-vault user
    with X-Vault-Id set to vault B would otherwise get vault A's graph and node
    counts (cross-vault data exposure). Honor the active-vault contextvar the
    same way `vault_routes.get_p()` does.
    """
    try:
        from backend.services.context_vars import get_active_vault_path

        active = get_active_vault_path()
        if active:
            return cast(Path, active)
    except Exception:
        pass
    return cast(Optional[Path], cfg.paths.get("VAULT"))
