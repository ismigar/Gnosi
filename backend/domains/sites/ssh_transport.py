"""Bounded system SSH/SFTP transport for administrator configured destinations."""
from __future__ import annotations

from contextlib import contextmanager
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import tempfile
from collections.abc import Iterator

from fastapi import HTTPException

from .models import TargetConnection


_ASKPASS = '#!/bin/sh\nprintf \'%s\\n\' "$GNOSI_SSH_PASSWORD"\n'
_ENVIRONMENT = ("HOME", "PATH", "USER", "LOGNAME", "LANG", "LC_ALL", "SSH_AUTH_SOCK", "TMPDIR")


def _validate(settings: TargetConnection) -> str:
    if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9.:-]{0,249}", settings.host):
        raise HTTPException(422, "Invalid SSH hostname")
    if not re.fullmatch(r"[a-zA-Z0-9_][a-zA-Z0-9_.@+-]{0,99}", settings.username):
        raise HTTPException(422, "Invalid SSH account")
    if isinstance(settings.port, bool) or not isinstance(settings.port, int) or not 1 <= settings.port <= 65535:
        raise HTTPException(422, "Invalid SSH port")
    authentication = getattr(settings, "authentication", "agent")
    if authentication not in {"agent", "key", "password"}:
        raise HTTPException(422, "Invalid SSH authentication method")
    reference = settings.ssh_key_reference
    if reference and not re.fullmatch(r"[a-zA-Z0-9_-]+", reference):
        raise HTTPException(422, "Invalid SSH key reference")
    if reference and not getattr(settings, "identity_file", ""):
        raise HTTPException(409, "Configure an explicit SSH identity file")
    return authentication


def _argv(settings: TargetConnection, protocol: str) -> list[str]:
    authentication = _validate(settings)
    binary = shutil.which(protocol)
    if not binary:
        raise HTTPException(503, f"{protocol.upper()} is unavailable")
    argv = [binary, "-o", "StrictHostKeyChecking=yes", "-o", "ConnectTimeout=10",
            "-o", "ConnectionAttempts=1", "-o", "NumberOfPasswordPrompts=1",
            "-o", "PermitLocalCommand=no", "-o", "ClearAllForwardings=yes",
            "-o", "BatchMode=" + ("no" if authentication == "password" else "yes")]
    if authentication == "password":
        argv += ["-o", "PreferredAuthentications=password", "-o", "PubkeyAuthentication=no",
                 "-o", "KbdInteractiveAuthentication=no", "-o", "PasswordAuthentication=yes"]
    elif authentication == "key":
        identity = getattr(settings, "identity_file", "")
        if not identity or any(ord(char) < 32 or ord(char) == 127 for char in identity):
            raise HTTPException(422, "Use an absolute SSH identity file path")
        path = Path(identity)
        if not path.is_absolute() or not path.is_file():
            raise HTTPException(422, "Use an existing absolute SSH identity file path")
        argv += ["-o", "IdentitiesOnly=yes", "-i", str(path)]
    # Keep the account separate from the destination so virtual accounts such
    # as alice@example.org cannot be parsed as part of the server hostname.
    argv += ["-o", "User=" + settings.username,
             "-p" if protocol == "ssh" else "-P", str(settings.port)]
    if protocol == "sftp":
        argv += ["-b", "-"]
    # SFTP's destination parser treats a colon as the path separator. Brackets
    # keep literal IPv6 addresses in the hostname portion.
    host = "[" + settings.host + "]" if protocol == "sftp" and ":" in settings.host else settings.host
    argv += [host]
    return argv


def ssh_argv(settings: TargetConnection) -> list[str]:
    """Build validated argv; credentials never appear in command arguments."""
    return _argv(settings, "ssh")


@contextmanager
def _environment(settings: TargetConnection, password: str | None) -> Iterator[dict[str, str]]:
    environment = {name: os.environ[name] for name in _ENVIRONMENT if name in os.environ}
    if getattr(settings, "authentication", "agent") != "password":
        yield environment
        return
    if not password or "\x00" in password:
        raise HTTPException(409, "Configure the SSH password first")
    # Only the child environment carries the secret. The helper contains constant
    # code and is removed even when launching the child fails or times out.
    with tempfile.TemporaryDirectory(prefix="gnosi-askpass-") as directory:
        helper = Path(directory) / "askpass"
        helper.write_text(_ASKPASS, encoding="utf-8")
        helper.chmod(0o700)
        environment.update(SSH_ASKPASS=str(helper), SSH_ASKPASS_REQUIRE="force",
                           DISPLAY="gnosi:0", GNOSI_SSH_PASSWORD=password)
        try:
            yield environment
        finally:
            environment.pop("GNOSI_SSH_PASSWORD", None)


def _run(settings: TargetConnection, argv: list[str], payload: bytes | None,
         timeout: int, password: str | None) -> bytes:
    if isinstance(timeout, bool) or not isinstance(timeout, (int, float)) or not 0 < timeout <= 300:
        raise HTTPException(422, "Use a connection timeout between 0 and 300 seconds")
    with _environment(settings, password) as environment:
        try:
            result = subprocess.run(argv, input=payload, capture_output=True, timeout=timeout,
                                    check=False, env=environment, start_new_session=True)
            if result.returncode:
                raise ValueError("Remote operation failed")
            return result.stdout
        except (OSError, ValueError, subprocess.TimeoutExpired):
            raise HTTPException(503, "The remote operation could not complete; verify the connection before retrying") from None


def run_ssh(settings: TargetConnection, command: str, payload: bytes | None = None,
            timeout: int = 45, password: str | None = None) -> bytes:
    """Run a trusted application-generated remote shell command with a deadline."""
    if not isinstance(command, str) or "\x00" in command:
        raise HTTPException(422, "Invalid SSH command")
    return _run(settings, ssh_argv(settings) + [command], payload, timeout, password)


def run_sftp(settings: TargetConnection, batch: str, timeout: int = 45,
             password: str | None = None) -> bytes:
    """Execute trusted SFTP batch instructions; use upload_sftp for path input."""
    if not isinstance(batch, str) or "\x00" in batch:
        raise HTTPException(422, "Invalid SFTP batch")
    return _run(settings, _argv(settings, "sftp"), batch.encode("utf-8"), timeout, password)


def probe_sftp(settings: TargetConnection, password: str | None = None) -> bool:
    try:
        run_sftp(settings, "pwd\nquit\n", password=password)
        return True
    except HTTPException:
        return False


def _quote_path(value: str) -> str:
    if not value or any(ord(char) < 32 or ord(char) == 127 for char in value):
        raise HTTPException(422, "Invalid SFTP path")
    # SFTP batch quoting is distinct from shell quoting. Escape glob syntax too,
    # so a local filename cannot select other files or expand to many uploads.
    escaped = re.sub(r'([\\"*?\[\]])', r'\\\1', value)
    return '"' + escaped + '"'


def upload_sftp(settings: TargetConnection, local: Path, remote: str,
                password: str | None = None) -> None:
    path = local.absolute()
    if not path.is_file():
        raise HTTPException(422, "Choose an existing file to upload")
    if (not remote.startswith("/") or ".." in PurePosixPath(remote).parts
            or not re.fullmatch(r"/[a-zA-Z0-9_./ -]+", remote)):
        raise HTTPException(422, "Use an absolute server file path")
    run_sftp(settings, "put " + _quote_path(str(path)) + " " + _quote_path(remote) + "\nquit\n",
             password=password)
