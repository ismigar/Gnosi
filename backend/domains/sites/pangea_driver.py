"""Native registered SSH/Suweb publishing, independent of former site tooling."""
from __future__ import annotations

import base64
from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
from typing import TYPE_CHECKING
import uuid

from fastapi import HTTPException

from .bounded_bridge import BoundedBridge
from .storage import SiteStore

if TYPE_CHECKING:
    from .pangea import Bridge


def import_root() -> Path:
    """Locate an optional static archive; never import or execute its scripts."""
    configured = os.environ.get("GNOSI_WEBSITE_IMPORT_ROOT", "")
    if configured:
        root = Path(configured)
    else:
        former_driver = Path(os.environ.get("GNOSI_WEB_PUBLISH_DRIVER", ""))
        root = former_driver.parent.parent if former_driver.is_absolute() else Path()
    if not root.is_absolute() or not root.is_dir():
        raise HTTPException(409, "Configure the existing website archive before importing it")
    return root


@dataclass
class PangeaDriver:
    REMOTE_ROOT: str
    CONFIG: Path
    settings: dict[str, str]

    def bridge(self) -> BoundedBridge:
        return BoundedBridge(self.settings, timeout=600)

    def php(self, bridge: Bridge, code: str) -> str:
        return bridge.run("php -r " + shlex.quote(code))

    def put(self, bridge: Bridge, source: Path, destination: str) -> None:
        """Stream bounded chunks over the authenticated session and verify bytes."""
        if not isinstance(bridge, BoundedBridge):
            raise HTTPException(503, "The registered website transfer session is unavailable")
        digest = hashlib.sha256()
        size = 0
        with source.open("rb") as stream:
            while chunk := stream.read(49152):
                bridge.remaining()
                digest.update(chunk)
                size += len(chunk)
        encoded_size = 4 * ((size + 2) // 3)
        marker, ready = "GNOSI_TRANSFER_" + uuid.uuid4().hex, "GNOSI_READY_" + uuid.uuid4().hex
        code = ('$left=' + str(encoded_size) + ';$path=' + json.dumps(destination) + ';'
                '$out=fopen($path,"wb");if($out===false){exit(2);}echo ' + json.dumps(ready + "\n") + ';fflush(STDOUT);'
                '$buffer="";while($left>0){$chunk=fread(STDIN,min(65536,$left));'
                'if($chunk===false||$chunk===""){exit(2);}$left-=strlen($chunk);$buffer.=$chunk;'
                '$n=strlen($buffer)-strlen($buffer)%4;$decoded=base64_decode(substr($buffer,0,$n),true);'
                'if($decoded===false){exit(3);}$buffer=substr($buffer,$n);'
                '$offset=0;while($offset<strlen($decoded)){$written=fwrite($out,substr($decoded,$offset));'
                'if($written===false||$written===0){exit(3);}$offset+=$written;}}fclose($out);'
                'if($buffer!==""||filesize($path)!==' + str(size) + '||hash_file("sha256",$path)!=='
                + json.dumps(digest.hexdigest()) + '){exit(3);}')
        bridge.run("true")
        child = bridge.child
        if child is None:
            raise HTTPException(503, "The registered website transfer session is unavailable")
        try:
            child.delaybeforesend = None
            child.sendline('stty -icanon; php -r ' + shlex.quote(code)
                           + '; __gnosi_transfer_status=$?; stty icanon; printf "\\n' + marker
                           + '%s\\n" "$__gnosi_transfer_status"')
            child.expect(ready + r"\r?\n")
            remaining = size
            with source.open("rb") as stream:
                while remaining:
                    chunk = stream.read(min(49152, remaining))
                    if not chunk:
                        raise HTTPException(409, "The website transfer source changed")
                    remaining -= len(chunk)
                    encoded = base64.b64encode(chunk).decode("ascii")
                    offset = 0
                    while offset < len(encoded):
                        written = child.send(encoded[offset:])
                        if written <= 0:
                            raise HTTPException(503, "The website file transfer was interrupted")
                        offset += written
                if stream.read(1):
                    raise HTTPException(409, "The website transfer source changed")
            child.expect(re.compile(r"(?m)^" + marker + r"(\d+)\r?$"))
            if int(child.match.group(1)):
                raise HTTPException(503, "The website file transfer failed integrity verification")
            child.expect(bridge.prompt)
        except Exception:
            bridge.close()
            raise


def load_driver(store: SiteStore) -> PangeaDriver:
    configured = os.environ.get("GNOSI_PANGEA_CONFIG", "")
    path = Path(configured) if configured else import_root() / ".local/web-publishing/config.json"
    if not path.is_absolute() or not path.is_file():
        raise HTTPException(503, "Configure the registered Pangea SSH connection first")
    config: object = json.loads(path.read_text())
    if not isinstance(config, dict) or config.get("target") != "staging":
        raise HTTPException(409, "Only the registered Pangea bridge is available")
    vaults = config.get("vault_paths", [])
    if not isinstance(vaults, list) or str(store.vault) not in [str(Path(value).resolve()) for value in vaults if isinstance(value, str)]:
        raise HTTPException(403, "This vault is not registered with the Pangea bridge")
    # Existing registrations predate the explicit remote_root setting.
    remote = config.get("remote_root", "/home/ismigar/webapps/web" if not configured else "")
    if not isinstance(remote, str) or not re.fullmatch(r"/[a-zA-Z0-9_./-]+", remote) or ".." in Path(remote).parts:
        raise HTTPException(409, "Invalid registered Pangea web root")
    settings = {name: os.environ.get(name, "") for name in ("SSH_HOST", "SSH_USER", "SSH_PASSWORD", "SSH_SUWEB_PASSWORD")}
    settings["SSH_PORT"] = os.environ.get("SSH_PORT", "22")
    settings["WORKING_DIRECTORY"] = remote
    for name, credential in (("SSH_PASSWORD", "ssh_password"), ("SSH_SUWEB_PASSWORD", "ssh_suweb_password")):
        if not settings[name]:
            from backend.security.keychain_manager import get_keychain
            settings[name] = get_keychain().get_credential(credential) or ""
    if any(not value for value in settings.values()):
        raise HTTPException(503, "Configure the registered website SSH credentials first")
    return PangeaDriver(remote, path, settings)
