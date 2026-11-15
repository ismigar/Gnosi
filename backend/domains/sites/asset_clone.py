"""Independent copy-on-write staging on APFS; ordinary copies remain fallback."""
from __future__ import annotations

import ctypes
import os
from pathlib import Path
import stat
import sys
import tempfile


def clone(source: int, directory: Path) -> Path | None:
    if sys.platform != 'darwin':
        return None
    temporary: Path | None = None
    try:
        function = ctypes.CDLL(None, use_errno=True).fclonefileat
        function.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint32]
        function.restype = ctypes.c_int
        # The kernel creates a new inode inside an exclusively owned directory.
        # It shares storage until either file changes, never a hard link.
        with tempfile.TemporaryDirectory(prefix='.gnosi-clone-', dir=directory) as scratch:
            descriptor = os.open(scratch, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            try:
                if function(source, descriptor, b'copy', 0) != 0:
                    return None
                cloned = Path(scratch) / 'copy'
                info = cloned.lstat()
                if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
                    raise ValueError('Invalid cloned asset')
                cloned.chmod(0o600)
                target, name = tempfile.mkstemp(prefix='.gnosi-asset-', dir=directory)
                os.close(target)
                temporary = Path(name)
                os.replace(cloned, temporary)
            finally:
                os.close(descriptor)
        return temporary
    except (OSError, AttributeError, ValueError):
        if temporary is not None:
            temporary.unlink(missing_ok=True)
        return None
