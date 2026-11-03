"""SFTP transfers staged privately, then verified and promoted by the owned SSH service."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import tempfile
from collections.abc import Callable
import uuid

from .models import TargetConnection
from .ssh_transport import upload_sftp


def write_sftp(settings: TargetConnection, namespace: str, identity: str, base: str,
               relative: str, data: bytes, private_root: str, private: bool,
               execute: Callable[[str], bytes]) -> None:
    pending = ".upload-" + uuid.uuid4().hex
    expected = hashlib.sha256(data).hexdigest()
    prefix = namespace + identity + "gnosi_namespace();"
    execute(prefix + "gnosi_write($p," + json.dumps(pending) + ',"",0600);')
    with tempfile.TemporaryDirectory(prefix="gnosi-site-transfer-") as folder:
        local = Path(folder) / "payload"
        local.write_bytes(data)
        local.chmod(0o600)
        upload_sftp(settings, local, private_root + "/" + pending, password=settings._password)
    # Never promote an unverified transfer or write through an unexpected link.
    code = prefix + "$tmp=$p." + json.dumps("/" + pending) + ";"
    code += "if(is_link($tmp)||!is_file($tmp)||hash_file('sha256',$tmp)!==" + json.dumps(expected) + "){throw new Exception('SFTP transfer failed verification');}"
    code += "gnosi_write(" + base + "," + json.dumps(relative) + ",file_get_contents($tmp)," + ("0600" if private else "0644") + ");unlink($tmp);"
    execute(code)
