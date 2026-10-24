"""Deadline-bound read sessions using the maintained SSH/Suweb login procedure."""
from __future__ import annotations

import base64
import re
import shlex
import time
import uuid
from typing import Protocol, cast

from fastapi import HTTPException


class Child(Protocol):
    timeout: float
    before: str
    match: re.Match[str]
    def expect(self, pattern: object) -> int: ...
    def sendline(self, value: str) -> int: ...
    def isalive(self) -> bool: ...
    def close(self, force: bool = True) -> None: ...


class BoundedBridge:
    """A single read session has one deadline across login and remote commands."""

    def __init__(self, settings: dict[str, str], timeout: float = 45) -> None:
        self.settings = settings
        self.deadline = time.monotonic() + timeout
        self.child: Child | None = None
        self.prompt = re.compile(r"(?m)^[^\r\n]*@[^\r\n]*:[^\r\n]*[#$%>] ?$")

    def __enter__(self) -> BoundedBridge:
        return self

    def __exit__(self, *args: object) -> None:
        self.close()

    def close(self) -> None:
        if self.child is not None:
            self.child.close(force=True)
            self.child = None

    def remaining(self) -> float:
        value = self.deadline - time.monotonic()
        if value <= 0:
            raise TimeoutError("The website status read exceeded its deadline")
        return value

    def expect(self, pattern: object) -> int:
        if self.child is None:
            raise RuntimeError("The SSH session is unavailable")
        self.child.timeout = self.remaining()
        return self.child.expect(pattern)

    def connect(self) -> None:
        import pexpect  # type: ignore[import-untyped]
        settings = self.settings
        self.child = cast(Child, pexpect.spawn("ssh", [
            "-o", "StrictHostKeyChecking=yes", "-o", "ConnectTimeout=20", "-o", "ServerAliveInterval=15",
            "-o", "ServerAliveCountMax=3", "-p", settings["SSH_PORT"], settings["SSH_USER"] + "@" + settings["SSH_HOST"],
        ], encoding="utf-8", timeout=self.remaining()))
        first = self.expect(["(?i)password:", "yes/no", self.prompt, pexpect.EOF])
        if first == 0:
            self.child.sendline(settings["SSH_PASSWORD"])
            self.expect(self.prompt)
        elif first != 2:
            raise RuntimeError("The registered SSH connection could not be verified")
        self.child.sendline("suweb")
        switch = self.expect(["(?i)password:", "(?i)contrase", self.prompt, pexpect.EOF])
        if switch in {0, 1}:
            self.child.sendline(settings["SSH_SUWEB_PASSWORD"])
            self.expect(self.prompt)
        elif switch != 2:
            raise RuntimeError("The registered Suweb connection is unavailable")
        self.child.sendline("stty -echo")
        self.expect(self.prompt)

    def run(self, command: str) -> str:
        try:
            self.remaining()
            if self.child is None:
                self.connect()
            if self.child is None:
                raise RuntimeError("The SSH connection is unavailable")
            marker = "GNOSI_SITE_READ_" + uuid.uuid4().hex
            script = "cd " + shlex.quote(self.settings["DRUPAL_PATH"]) + " || exit 1\n" + command
            encoded = base64.b64encode(script.encode()).decode()
            envelope = "printf %s " + shlex.quote(encoded) + ' | base64 -d | bash; __gnosi_read=$?; printf "\\n' + marker + '%s\\n" "$__gnosi_read"'
            self.child.sendline(envelope)
            self.expect(re.compile(r"(?m)^" + marker + r"(\d+)\r?$"))
            status = int(self.child.match.group(1))
            output = self.child.before.strip()
            self.expect(self.prompt)
            if status:
                raise RuntimeError("The private website read could not complete")
            return output
        except Exception:
            self.close()
            raise HTTPException(503, "The Pangea read could not complete; refresh to retry") from None
