"""Windows handles for versioned Reader media on local and cloud-backed NTFS."""

import ctypes
from ctypes import wintypes
import errno
from functools import cache
import ntpath
import os
from pathlib import Path
import sys
from typing import BinaryIO


_GENERIC_READ = 0x80000000
_FILE_READ_ATTRIBUTES = 0x80
_SHARE_READ_DELETE = 0x5
_SHARE_READ_WRITE_DELETE = 0x7
_OPEN_EXISTING = 3
_OPEN_NO_RECALL = 0x00100000


class _FileBasicInfo(ctypes.Structure):
    _fields_ = [(name, ctypes.c_int64) for name in (
        "creation_time", "last_access_time", "last_write_time", "change_time",
    )] + [("file_attributes", wintypes.DWORD)]


@cache
def _kernel() -> ctypes.CDLL:
    if sys.platform != "win32":
        raise OSError("Windows library is unavailable on this platform")
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.CreateFileW.argtypes = (wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, wintypes.LPVOID,
                                  wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE)
    kernel.CreateFileW.restype = wintypes.HANDLE
    kernel.CloseHandle.argtypes = (wintypes.HANDLE,)
    kernel.CloseHandle.restype = wintypes.BOOL
    kernel.GetFinalPathNameByHandleW.argtypes = (wintypes.HANDLE, wintypes.LPWSTR, wintypes.DWORD, wintypes.DWORD)
    kernel.GetFinalPathNameByHandleW.restype = wintypes.DWORD
    kernel.GetFileInformationByHandleEx.argtypes = (wintypes.HANDLE, ctypes.c_int, wintypes.LPVOID, wintypes.DWORD)
    kernel.GetFileInformationByHandleEx.restype = wintypes.BOOL
    return kernel


def _same_handle_path(final: str, expected: str) -> bool:
    def normal(path: str) -> str:
        path = ntpath.normcase(ntpath.normpath(path))
        if path.startswith("\\\\?\\unc\\"):
            return "\\\\" + path[8:]
        return path.removeprefix("\\\\?\\")
    return normal(final) == normal(expected)


def open_file(path: Path, *, read_audio: bool) -> BinaryIO:
    """Open a pinned handle and check its actual target, including junctions."""
    if sys.platform != "win32":
        raise OSError("Windows handles are unavailable on this platform")
    import msvcrt

    vault = path.parents[2].resolve(strict=True)
    expected = vault / path.parents[1].name / path.parent.name / path.name
    kernel = _kernel()
    # Metadata opens allow sync and avoid recall. Playback permits atomic
    # replacement but excludes concurrent in-place writers.
    access = _GENERIC_READ if read_audio else _FILE_READ_ATTRIBUTES
    sharing = _SHARE_READ_DELETE if read_audio else _SHARE_READ_WRITE_DELETE
    flags = 0 if read_audio else _OPEN_NO_RECALL
    handle = kernel.CreateFileW(str(path), access, sharing, None, _OPEN_EXISTING, flags, None)
    if handle == ctypes.c_void_p(-1).value:
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        length = kernel.GetFinalPathNameByHandleW(handle, None, 0, 0)
        if not length:
            raise ctypes.WinError(ctypes.get_last_error())
        buffer = ctypes.create_unicode_buffer(length + 1)
        copied = kernel.GetFinalPathNameByHandleW(handle, buffer, len(buffer), 0)
        if not copied:
            raise ctypes.WinError(ctypes.get_last_error())
        if copied >= len(buffer) or not _same_handle_path(buffer.value, str(expected)):
            raise FileNotFoundError(errno.ENOENT, "Podcast is outside its Vault publication directory")
        descriptor = msvcrt.open_osfhandle(handle, os.O_RDONLY | os.O_BINARY)
    except BaseException:
        kernel.CloseHandle(handle)
        raise
    return os.fdopen(descriptor, "rb", buffering=0)


def change_time(descriptor: int) -> int:
    """Read the NTFS change stamp, independent of a preserved mtime/birthtime."""
    if sys.platform != "win32":
        raise OSError("Windows handles are unavailable on this platform")
    import msvcrt

    basic = _FileBasicInfo()
    handle = msvcrt.get_osfhandle(descriptor)
    if not _kernel().GetFileInformationByHandleEx(handle, 0, ctypes.byref(basic), ctypes.sizeof(basic)):
        raise ctypes.WinError(ctypes.get_last_error())
    if not basic.change_time:
        raise OSError("Filesystem did not provide a podcast file revision")
    return int(basic.change_time)
