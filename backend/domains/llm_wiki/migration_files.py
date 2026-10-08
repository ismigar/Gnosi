"""Verified backups and compare-before-write files for the Brain field migration."""

from __future__ import annotations

import hashlib
import json
import tarfile
from datetime import datetime, timezone
from pathlib import Path

import yaml

from backend.domains.vault.registry.records import is_record
from backend.domains.vault.registry.state import RegistryData
from backend.utils.metadata_io import read_metadata_text
from backend.utils.safe_io import safe_write_json, safe_write_text


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def read_json(path: Path) -> dict[str, object]:
    value = json.loads(read_metadata_text(path, encoding="utf-8"))
    return string_record(value)


def string_record(value: object) -> dict[str, object]:
    if not is_record(value) or any(not isinstance(key, str) for key in value):
        raise ValueError("Expected JSON object with textual keys")
    return {key: item for key, item in value.items() if isinstance(key, str)}


def frontmatter(text: str) -> tuple[RegistryData, str]:
    lines = text.splitlines(keepends=True)
    if not lines or lines[0].strip() != "---":
        raise ValueError("Missing Markdown frontmatter")
    end = next((i for i, line in enumerate(lines[1:], 1) if line.strip() == "---"), None)
    if end is None:
        raise ValueError("Unterminated Markdown frontmatter")
    metadata = yaml.safe_load("".join(lines[1:end]))
    if not is_record(metadata):
        raise ValueError("Expected Markdown metadata object")
    return dict(metadata), "".join(lines[end + 1 :])


def markdown(metadata: RegistryData, body: str) -> str:
    return "---\n" + yaml.safe_dump(metadata, allow_unicode=True, sort_keys=False) + "---\n" + body


def json_text(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2, default=str) + "\n"


def change(vault: Path, path: Path, text: str) -> dict[str, object] | None:
    original = path.read_bytes() if path.exists() else None
    if original == text.encode("utf-8"):
        return None
    return {
        "path": str(path.relative_to(vault)),
        "before_sha256": digest(original) if original is not None else None,
        "after_sha256": digest(text.encode("utf-8")),
        "text": text,
    }


def apply(vault: Path, output: Path, changes: list[dict[str, object]]) -> dict[str, object]:
    """All comparisons precede mutation; a verified archive survives interruption."""
    journal_path = output / "apply-journal.json"
    journal = read_json(journal_path) if journal_path.exists() else {}
    if journal and journal.get("plan_sha256") != digest(json_text(changes).encode()):
        raise ValueError("Migration journal belongs to a different plan")
    for item in changes:
        path = (vault / str(item["path"])).resolve()
        if not path.is_relative_to(vault.resolve()):
            raise ValueError("Migration target escapes the vault")
        actual = digest(path.read_bytes()) if path.exists() else None
        permitted = {item["before_sha256"]}
        if journal:
            permitted.add(item["after_sha256"])
        if actual not in permitted:
            raise ValueError(f"File changed after preview: {item['path']}")
    archive = output / "vault-before.tar.gz"
    if journal and files_digest(archive) != journal.get("backup_sha256"):
        raise ValueError("Migration backup changed after verification")
    if not journal:
        if archive.exists():
            raise ValueError("Unjournaled backup exists; inspect before resuming")
        with tarfile.open(archive, "w:gz", compresslevel=1) as target:
            for item in changes:
                if item["before_sha256"] is not None:
                    target.add(vault / str(item["path"]), arcname=str(item["path"]))
        with tarfile.open(archive) as source:
            for item in changes:
                if item["before_sha256"] is None:
                    continue
                stream = source.extractfile(str(item["path"]))
                if stream is None or digest(stream.read()) != item["before_sha256"]:
                    raise ValueError("Backup verification failed")
        journal = {
            "plan_sha256": digest(json_text(changes).encode()),
            "backup": str(archive),
            "backup_sha256": files_digest(archive),
            "applied": [],
            "complete": False,
        }
        safe_write_json(journal_path, journal, indent=2)
    applied = journal["applied"]
    assert isinstance(applied, list)
    for item in changes:
        path = vault / str(item["path"])
        actual = digest(path.read_bytes()) if path.exists() else None
        if actual != item["after_sha256"]:
            if actual != item["before_sha256"]:
                raise ValueError("File changed while applying migration")
            safe_write_text(path, str(item["text"]))
            if digest(path.read_bytes()) != item["after_sha256"]:
                raise ValueError("Migration write verification failed")
        if item["path"] not in applied:
            applied.append(item["path"])
        safe_write_json(journal_path, journal, indent=2)
    journal.update(complete=True, finished_at=datetime.now(timezone.utc).isoformat())
    safe_write_json(journal_path, journal, indent=2)
    return journal


def rollback(vault: Path, output: Path, changes: list[dict[str, object]]) -> None:
    journal = read_json(output / "apply-journal.json")
    if files_digest(Path(str(journal["backup"]))) != journal.get("backup_sha256"):
        raise ValueError("Migration backup changed after verification")
    with tarfile.open(str(journal["backup"])) as archive:
        for item in changes:
            path = vault / str(item["path"])
            actual = digest(path.read_bytes()) if path.exists() else None
            if actual not in {item["before_sha256"], item["after_sha256"]}:
                raise ValueError("Cannot overwrite a concurrent edit during rollback")
        for item in changes:
            if item["before_sha256"] is None:
                (vault / str(item["path"])).unlink(missing_ok=True)
                continue
            stream = archive.extractfile(str(item["path"]))
            if stream is None:
                raise ValueError("Incomplete migration backup")
            data = stream.read()
            if digest(data) != item["before_sha256"]:
                raise ValueError("Invalid backup content")
            safe_write_text(vault / str(item["path"]), data.decode("utf-8"))
    journal.update(complete=False, rolled_back=True)
    safe_write_json(output / "apply-journal.json", journal, indent=2)


def files_digest(path: Path) -> str:
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()
